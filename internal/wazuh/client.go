// Package wazuh is a read-only client for the Wazuh manager API. It uses only
// the standard library. It collects inventory from the syscollector module of
// each agent. Endpoint paths follow the Wazuh 4.x API; check them against the
// version you run.
package wazuh

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/scriptkinder88/swift-iso-analyser/internal/model"
)

// Config holds the connection settings. Credentials come from the environment
// (see cmd/server), never from files in the repository.
type Config struct {
	BaseURL  string // e.g. https://wazuh.internal:55000
	User     string
	Password string
	CAFile   string // optional PEM bundle for an internal CA
	Timeout  time.Duration
}

type Client struct {
	cfg   Config
	http  *http.Client
	mu    sync.Mutex
	token string
	exp   time.Time
}

var agentIDPattern = regexp.MustCompile(`^[0-9]{1,5}$`)

// categories maps inventory category to the syscollector endpoint.
var categories = map[string]string{
	"hardware": "/syscollector/%s/hardware",
	"os":       "/syscollector/%s/os",
	"packages": "/syscollector/%s/packages",
	"ports":    "/syscollector/%s/ports",
}

// New builds a client. It refuses plain HTTP unless the base URL is localhost.
func New(cfg Config) (*Client, error) {
	u, err := url.Parse(cfg.BaseURL)
	if err != nil || u.Host == "" {
		return nil, fmt.Errorf("invalid Wazuh URL %q", cfg.BaseURL)
	}
	if u.Scheme != "https" && !strings.HasPrefix(u.Host, "localhost") && !strings.HasPrefix(u.Host, "127.0.0.1") {
		return nil, fmt.Errorf("Wazuh URL must use https")
	}
	tlsCfg := &tls.Config{MinVersion: tls.VersionTLS12}
	if cfg.CAFile != "" {
		pem, err := os.ReadFile(cfg.CAFile)
		if err != nil {
			return nil, fmt.Errorf("read CA file: %w", err)
		}
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(pem) {
			return nil, fmt.Errorf("CA file contains no certificates")
		}
		tlsCfg.RootCAs = pool
	}
	timeout := cfg.Timeout
	if timeout == 0 {
		timeout = 20 * time.Second
	}
	return &Client{
		cfg: cfg,
		http: &http.Client{
			Timeout:   timeout,
			Transport: &http.Transport{TLSClientConfig: tlsCfg},
		},
	}, nil
}

func (c *Client) login(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.cfg.BaseURL+"/security/user/authenticate", nil)
	if err != nil {
		return err
	}
	req.SetBasicAuth(c.cfg.User, c.cfg.Password)
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("wazuh login: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("wazuh login: HTTP %d", resp.StatusCode)
	}
	var body struct {
		Data struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&body); err != nil {
		return fmt.Errorf("wazuh login: bad response: %w", err)
	}
	if body.Data.Token == "" {
		return fmt.Errorf("wazuh login: empty token")
	}
	c.token = body.Data.Token
	c.exp = time.Now().Add(10 * time.Minute) // Wazuh tokens last 15 min by default
	return nil
}

func (c *Client) getToken(ctx context.Context, force bool) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if force || c.token == "" || time.Now().After(c.exp) {
		if err := c.login(ctx); err != nil {
			return "", err
		}
	}
	return c.token, nil
}

type envelope struct {
	Data struct {
		AffectedItems []map[string]any `json:"affected_items"`
		Total         int              `json:"total_affected_items"`
	} `json:"data"`
}

func (c *Client) get(ctx context.Context, path string, query url.Values, out *envelope) error {
	for attempt := 0; attempt < 2; attempt++ {
		token, err := c.getToken(ctx, attempt > 0)
		if err != nil {
			return err
		}
		u := c.cfg.BaseURL + path
		if len(query) > 0 {
			u += "?" + query.Encode()
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
		if err != nil {
			return err
		}
		req.Header.Set("Authorization", "Bearer "+token)
		resp, err := c.http.Do(req)
		if err != nil {
			return fmt.Errorf("wazuh GET %s: %w", path, err)
		}
		status := resp.StatusCode
		if status == http.StatusUnauthorized && attempt == 0 {
			resp.Body.Close()
			continue
		}
		if status != http.StatusOK {
			resp.Body.Close()
			return fmt.Errorf("wazuh GET %s: HTTP %d", path, status)
		}
		err = json.NewDecoder(io.LimitReader(resp.Body, 16<<20)).Decode(out)
		resp.Body.Close()
		return err
	}
	return fmt.Errorf("wazuh GET %s: unauthorized after re-login", path)
}

// Collect reads the requested inventory categories for one agent. The limit
// keeps large package lists bounded.
func (c *Client) Collect(ctx context.Context, agentID string, cats []string, limit int) ([]model.InventoryItem, error) {
	if !agentIDPattern.MatchString(agentID) {
		return nil, fmt.Errorf("invalid agent id %q", agentID)
	}
	if limit <= 0 {
		limit = 200
	}
	now := time.Now().UTC()
	var items []model.InventoryItem
	for _, cat := range cats {
		tmpl, ok := categories[cat]
		if !ok {
			return nil, fmt.Errorf("unknown inventory category %q", cat)
		}
		var env envelope
		q := url.Values{"limit": {fmt.Sprint(limit)}}
		if err := c.get(ctx, fmt.Sprintf(tmpl, url.PathEscape(agentID)), q, &env); err != nil {
			return nil, err
		}
		for _, raw := range env.Data.AffectedItems {
			fields := map[string]string{}
			flatten("", raw, fields)
			items = append(items, model.InventoryItem{
				Category: cat,
				Fields:   fields,
				Source:   "wazuh",
				SeenAt:   now,
			})
		}
	}
	return items, nil
}

// flatten turns nested JSON into dotted keys, e.g. "cpu.name" -> value.
func flatten(prefix string, v any, out map[string]string) {
	switch t := v.(type) {
	case map[string]any:
		keys := make([]string, 0, len(t))
		for k := range t {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			key := k
			if prefix != "" {
				key = prefix + "." + k
			}
			flatten(key, t[k], out)
		}
	case []any:
		b, _ := json.Marshal(t)
		out[prefix] = string(b)
	case nil:
		out[prefix] = ""
	default:
		out[prefix] = fmt.Sprint(t)
	}
}

// SyncAll collects inventory for every component that has an agent id.
// It returns the inventory keyed by component id, plus per-component errors.
func (c *Client) SyncAll(ctx context.Context, comps []model.Component) (map[string][]model.InventoryItem, map[string]string) {
	result := map[string][]model.InventoryItem{}
	errs := map[string]string{}
	cats := []string{"hardware", "os", "packages", "ports"}
	for _, comp := range comps {
		if comp.AgentID == "" {
			continue
		}
		items, err := c.Collect(ctx, comp.AgentID, cats, 200)
		if err != nil {
			errs[comp.ID] = err.Error()
			continue
		}
		result[comp.ID] = items
	}
	return result, errs
}
