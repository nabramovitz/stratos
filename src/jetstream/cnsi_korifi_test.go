package main

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"gopkg.in/DATA-DOG/go-sqlmock.v1"
)

// setupMockKorifiServer mimics a default-configuration Korifi endpoint:
// root doc with cf_on_k8s + a +cf-k8s version suffix and no UAA, /v2/info
// absent, /v3/info present.
func setupMockKorifiServer(t *testing.T) *httptest.Server {
	var server *httptest.Server
	server = httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/":
			w.Write([]byte(`{
				"links": {
					"self": {"href": "` + server.URL + `"},
					"cloud_controller_v3": {"href": "` + server.URL + `/v3", "meta": {"version": "3.117.0+cf-k8s"}},
					"login": {"href": "` + server.URL + `"},
					"uaa": null,
					"logging": null,
					"routing": null
				},
				"cf_on_k8s": true
			}`))
		case "/v2/info":
			w.WriteHeader(http.StatusNotFound)
		case "/v3/info":
			w.Write([]byte(`{"build":"","name":"","links":{"self":{"href":"` + server.URL + `/v3/info"}}}`))
		default:
			t.Errorf("Unexpected path '%s'", r.URL.Path)
		}
	}))
	return server
}

func registerKorifiEndpoint(t *testing.T, params map[string]string, expectedSubType string) {
	mockKorifi := setupMockKorifiServer(t)
	defer mockKorifi.Close()

	base := map[string]string{
		"cnsi_name":           "Korifi Cluster",
		"api_endpoint":        mockKorifi.URL,
		"skip_ssl_validation": "true",
		"cnsi_client_id":      mockClientId,
		"cnsi_client_secret":  mockClientSecret,
	}
	for k, v := range params {
		base[k] = v
	}
	req := setupMockReq("POST", "", base)

	_, _, ctx, pp, db, mock := setupHTTPTest(req)
	defer db.Close()

	sessionValues := make(map[string]interface{})
	sessionValues["user_id"] = mockUserGUID
	sessionValues["exp"] = time.Now().AddDate(0, 0, 1).Unix()
	if errSession := pp.setSessionValues(ctx, sessionValues); errSession != nil {
		t.Error(errors.New("unable to mock/stub user in session object"))
	}

	// v3-only endpoint: auth endpoint backfilled from the root login link,
	// token/doppler endpoints empty (uaa/logging are null on Korifi), and
	// the detection metadata records v3-only + no UAA.
	mock.ExpectExec(insertIntoCNSIs).
		WithArgs(sqlmock.AnyArg(), "Korifi Cluster", "cf", mockKorifi.URL, mockKorifi.URL, "", "", true, mockClientId, sqlmock.AnyArg(), false,
			expectedSubType, `{"supportsV2":false,"supportsV3":true,"assumed":false,"hasUaa":false}`, "", "").
		WillReturnResult(sqlmock.NewResult(1, 1))

	if err := pp.RegisterEndpoint(ctx, getCFPlugin(pp, "cf").Info); err != nil {
		t.Errorf("Failed to register Korifi cluster: %v", err)
	}

	if dberr := mock.ExpectationsWereMet(); dberr != nil {
		t.Errorf("There were unfulfilled expectations: %s", dberr)
	}
}

// A Korifi endpoint registered without an explicit sub_type gets the
// detected "korifi" subtype persisted.
func TestRegisterKorifiClusterDetectsSubType(t *testing.T) {
	t.Parallel()
	registerKorifiEndpoint(t, nil, "korifi")
}

// An explicit sub_type supplied at registration wins over detection.
func TestRegisterKorifiClusterExplicitSubTypeWins(t *testing.T) {
	t.Parallel()
	registerKorifiEndpoint(t, map[string]string{"sub_type": "korifi-flavor"}, "korifi-flavor")
}
