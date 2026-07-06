package cloudfoundry

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/cloudfoundry/stratos/src/jetstream/api"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Korifi advertises itself via cf_on_k8s and a +cf-k8s CC version suffix —
// either signal marks the endpoint; a classic CF root doc matches neither.
func TestIsKorifi(t *testing.T) {
	t.Parallel()

	korifiRoot := `{
		"links": {
			"cloud_controller_v3": {"href": "https://localhost/v3", "meta": {"version": "3.117.0+cf-k8s"}},
			"login": {"href": "https://localhost"},
			"uaa": null
		},
		"cf_on_k8s": true
	}`
	var root api.ApiRoot
	require.NoError(t, json.Unmarshal([]byte(korifiRoot), &root))
	assert.True(t, isKorifi(root))

	// Version suffix alone suffices (cf_on_k8s absent)
	suffixOnly := api.ApiRoot{}
	suffixOnly.Links.CloudControllerV3.Meta.Version = "3.117.0+cf-k8s"
	assert.True(t, isKorifi(suffixOnly))

	// cf_on_k8s alone suffices
	assert.True(t, isKorifi(api.ApiRoot{CFOnK8s: true}))

	// Classic CF matches neither
	classic := api.ApiRoot{}
	classic.Links.CloudControllerV3.Meta.Version = "3.180.0"
	assert.False(t, isKorifi(classic))
}

// The /whoami probe validates the pasted token and yields the identity;
// a rejected token or an unreadable body must fail the connect.
func TestFetchKorifiIdentity(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/whoami", r.URL.Path)
		switch r.Header.Get("Authorization") {
		case "bearer good-token":
			w.Write([]byte(`{"name":"system:serviceaccount:cf:stratos-test","kind":"ServiceAccount"}`))
		case "bearer garbage-response":
			w.Write([]byte(`not json`))
		default:
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte(`{"errors":[{"detail":"Authentication error","title":"CF-NotAuthenticated","code":10002}]}`))
		}
	}))
	defer server.Close()

	identity, err := fetchKorifiIdentity(*server.Client(), server.URL, "good-token")
	require.NoError(t, err)
	assert.Equal(t, "system:serviceaccount:cf:stratos-test", identity.Name)
	assert.Equal(t, "ServiceAccount", identity.Kind)

	_, err = fetchKorifiIdentity(*server.Client(), server.URL, "bad-token")
	assert.Error(t, err)

	_, err = fetchKorifiIdentity(*server.Client(), server.URL, "garbage-response")
	assert.Error(t, err)
}

// User lookups resolve from the identity cached on the token record at
// connect time — no live re-probe. A record without one (e.g. legacy token)
// resolves to no user rather than a panic.
func TestKorifiUserInfo(t *testing.T) {
	t.Parallel()

	c := &CloudFoundrySpecification{}

	user, ok := c.korifiUserInfo("cnsi-guid", &api.TokenRecord{
		Metadata: `{"name":"system:serviceaccount:cf:stratos-test","kind":"ServiceAccount"}`,
	})
	require.True(t, ok)
	assert.Equal(t, "system:serviceaccount:cf:stratos-test", user.Name)
	assert.Equal(t, "system:serviceaccount:cf:stratos-test", user.GUID)
	// No admin signal exists on Korifi — the flag stays false
	assert.False(t, user.Admin)

	_, ok = c.korifiUserInfo("cnsi-guid", &api.TokenRecord{Metadata: ""})
	assert.False(t, ok)
}
