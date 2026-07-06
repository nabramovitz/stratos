package cloudfoundry

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/cloudfoundry/stratos/src/jetstream/api"
	"github.com/labstack/echo/v4"
	log "github.com/sirupsen/logrus"
)

// AuthConnectTypeKorifiToken is the auth type for Korifi endpoints connected
// with a pasted Kubernetes bearer token (ServiceAccount or OIDC). Korifi has
// no token refresh — expiry means reconnect, same UX as kube endpoints.
const AuthConnectTypeKorifiToken = "korifi-token"

// korifiIdentity is Korifi's GET /whoami response.
type korifiIdentity struct {
	Name string `json:"name"`
	Kind string `json:"kind"`
}

// registerKorifiAuthProvider wires the korifi-token auth type into Jetstream,
// following the kube plugin's k8s-token pattern (plugin-owned provider).
func (c *CloudFoundrySpecification) registerKorifiAuthProvider() {
	c.portalProxy.AddAuthProvider(AuthConnectTypeKorifiToken, api.AuthProvider{
		Handler:  c.doKorifiTokenFlowRequest,
		UserInfo: c.korifiUserInfo,
	})
}

// connectKorifiToken handles connecting a Korifi endpoint with a pasted
// bearer token. The /whoami probe both validates the token and yields the
// identity, which is cached on the token record so user lookups don't
// re-probe the endpoint.
func (c *CloudFoundrySpecification) connectKorifiToken(cnsiRecord api.CNSIRecord, ec echo.Context) (*api.TokenRecord, error) {
	token := strings.Join(strings.Fields(ec.FormValue("token")), "")
	if token == "" {
		return nil, fmt.Errorf("need a bearer token to connect to a Korifi endpoint")
	}

	h := c.portalProxy.GetHttpClient(cnsiRecord.SkipSSLValidation, cnsiRecord.CACert)
	identity, err := fetchKorifiIdentity(h, cnsiRecord.APIEndpoint.String(), token)
	if err != nil {
		return nil, err
	}

	// K8s ServiceAccount/OIDC tokens are JWTs — take the real expiry when
	// parseable, else fall back to a year (opaque tokens; passthrough will
	// surface a 401 once the endpoint rejects them).
	expiry := time.Now().AddDate(1, 0, 0).Unix()
	if userTokenInfo, err := c.portalProxy.GetUserTokenInfo(token); err == nil && userTokenInfo.TokenExpiry > 0 {
		expiry = userTokenInfo.TokenExpiry
	}

	tokenRecord := c.portalProxy.InitEndpointTokenRecord(expiry, token, "__NONE__", false)
	tokenRecord.AuthType = AuthConnectTypeKorifiToken
	if identityJSON, err := json.Marshal(identity); err == nil {
		tokenRecord.Metadata = string(identityJSON)
	}
	return &tokenRecord, nil
}

// fetchKorifiIdentity validates the token against the endpoint's /whoami.
func fetchKorifiIdentity(h http.Client, apiEndpoint string, token string) (*korifiIdentity, error) {
	req, err := http.NewRequest("GET", apiEndpoint+"/whoami", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "bearer "+token)

	res, err := h.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil, fmt.Errorf("the endpoint rejected the token (%d from /whoami)", res.StatusCode)
	}

	identity := &korifiIdentity{}
	if err := json.NewDecoder(res.Body).Decode(identity); err != nil || identity.Name == "" {
		return nil, fmt.Errorf("could not read identity from /whoami")
	}
	return identity, nil
}

// korifiUserInfo resolves the connected user from the identity cached at
// connect time. Korifi exposes no admin signal (/whoami is name+kind only;
// authorization lives in K8s RBAC), so Admin stays false — Stratos's CF admin
// flag is UI-level only, and the ops behind the admin UI are largely absent
// on Korifi anyway. Upgrade path: an upstream enrichment of /whoami.
func (c *CloudFoundrySpecification) korifiUserInfo(cnsiGUID string, tokenRecord *api.TokenRecord) (*api.ConnectedUser, bool) {
	identity := &korifiIdentity{}
	if err := json.Unmarshal([]byte(tokenRecord.Metadata), identity); err != nil || identity.Name == "" {
		log.Debugf("korifiUserInfo: no cached identity for token %s", tokenRecord.TokenGUID)
		return nil, false
	}
	return &api.ConnectedUser{
		GUID:   identity.Name,
		Name:   identity.Name,
		Scopes: make([]string, 0),
	}, true
}

// doKorifiTokenFlowRequest attaches the stored bearer token — no refresh.
func (c *CloudFoundrySpecification) doKorifiTokenFlowRequest(cnsiRequest *api.CNSIRequest, req *http.Request) (*http.Response, error) {
	authHandler := func(tokenRec api.TokenRecord, cnsi api.CNSIRecord) (*http.Response, error) {
		req.Header.Set("Authorization", "bearer "+tokenRec.AuthToken)
		client := c.portalProxy.GetHttpClientForRequest(req, cnsi.SkipSSLValidation, cnsi.CACert)
		return client.Do(req)
	}
	return c.portalProxy.DoAuthFlowRequest(cnsiRequest, req, authHandler)
}
