package wazuh

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestFlattenNestedObject(t *testing.T) {
	var raw map[string]any
	if err := json.Unmarshal([]byte(`{"cpu":{"name":"Xeon","cores":8},"board_serial":"ABC","tags":["a","b"],"nothing":null}`), &raw); err != nil {
		t.Fatal(err)
	}
	out := map[string]string{}
	flatten("", raw, out)
	checks := map[string]string{
		"cpu.name":     "Xeon",
		"cpu.cores":    "8",
		"board_serial": "ABC",
		"tags":         `["a","b"]`,
		"nothing":      "",
	}
	for k, want := range checks {
		if out[k] != want {
			t.Errorf("%s = %q, want %q", k, out[k], want)
		}
	}
}

func TestRejectsPlainHTTPForRemoteHost(t *testing.T) {
	if _, err := New(Config{BaseURL: "http://wazuh.internal:55000"}); err == nil {
		t.Fatal("expected plain http to a remote host to be rejected")
	}
	if _, err := New(Config{BaseURL: "http://127.0.0.1:55000"}); err != nil {
		t.Fatalf("localhost http should be allowed: %v", err)
	}
}

func TestCollectReadsSyscollectorWithToken(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/security/user/authenticate":
			w.Write([]byte(`{"data":{"token":"tok123"}}`))
		case strings.HasPrefix(r.URL.Path, "/syscollector/001/hardware"):
			if r.Header.Get("Authorization") != "Bearer tok123" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			w.Write([]byte(`{"data":{"affected_items":[{"board_serial":"S1","cpu":{"name":"CPU X"}}],"total_affected_items":1}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	c, err := New(Config{BaseURL: srv.URL, User: "u", Password: "p"})
	if err != nil {
		t.Fatal(err)
	}
	items, err := c.Collect(context.Background(), "001", []string{"hardware"}, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].Fields["cpu.name"] != "CPU X" || items[0].Source != "wazuh" {
		t.Fatalf("unexpected items: %+v", items)
	}
}

func TestCollectRejectsBadAgentID(t *testing.T) {
	c, _ := New(Config{BaseURL: "http://127.0.0.1:1"})
	if _, err := c.Collect(context.Background(), "../etc", []string{"hardware"}, 10); err == nil {
		t.Fatal("expected invalid agent id error")
	}
}
