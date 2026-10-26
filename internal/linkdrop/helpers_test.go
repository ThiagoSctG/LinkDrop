package linkdrop_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/ThiagoSctG/LinkDrop/internal/linkdrop"
)

type fakeClock struct {
	mu  sync.Mutex
	now time.Time
}

func newFakeClock() *fakeClock {
	return &fakeClock{now: time.Date(2026, 7, 9, 10, 0, 0, 0, time.UTC)}
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

type harness struct {
	t      *testing.T
	clock  *fakeClock
	server *httptest.Server
	app    *linkdrop.Server
}

func newHarness(t *testing.T, configure ...func(*linkdrop.Config)) *harness {
	t.Helper()
	clock := newFakeClock()
	cfg := linkdrop.Config{Now: clock.Now}
	for _, apply := range configure {
		apply(&cfg)
	}
	app := linkdrop.New(cfg)
	server := httptest.NewServer(app)
	t.Cleanup(func() {
		_ = app.Shutdown(context.Background())
		server.Close()
	})
	return &harness{t: t, clock: clock, server: server, app: app}
}

type response struct {
	status int
	header http.Header
	body   []byte
}

func (r response) json(t *testing.T) map[string]any {
	t.Helper()
	var value map[string]any
	if err := json.Unmarshal(r.body, &value); err != nil {
		t.Fatalf("decode %q: %v", r.body, err)
	}
	return value
}

func (h *harness) do(method, path string, headers map[string]string, body any) response {
	h.t.Helper()
	var reader io.Reader
	switch value := body.(type) {
	case nil:
	case string:
		reader = bytes.NewBufferString(value)
	default:
		encoded, err := json.Marshal(value)
		if err != nil {
			h.t.Fatal(err)
		}
		reader = bytes.NewReader(encoded)
	}
	request, err := http.NewRequest(method, h.server.URL+path, reader)
	if err != nil {
		h.t.Fatal(err)
	}
	if body != nil {
		request.Header.Set("content-type", "application/json")
	}
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	res, err := h.server.Client().Do(request)
	if err != nil {
		h.t.Fatal(err)
	}
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	if err != nil {
		h.t.Fatal(err)
	}
	return response{status: res.StatusCode, header: res.Header, body: data}
}

type screen struct {
	Token      string `json:"token"`
	ScreenKey  string `json:"screenKey"`
	PairingURL string `json:"pairingUrl"`
	ExpiresAt  string `json:"expiresAt"`
}

type pairing struct {
	SessionID   string `json:"sessionId"`
	EndpointKey string `json:"endpointKey"`
	Role        string `json:"role"`
}

type session struct {
	screen screen
	phone  pairing
}

func (s session) screenHeaders() map[string]string {
	return map[string]string{"x-endpoint-key": s.screen.ScreenKey}
}

func (s session) phoneHeaders() map[string]string {
	return map[string]string{"x-endpoint-key": s.phone.EndpointKey}
}

func decode[T any](t *testing.T, r response) T {
	t.Helper()
	var value T
	if err := json.Unmarshal(r.body, &value); err != nil {
		t.Fatalf("decode %q: %v", r.body, err)
	}
	return value
}

func (h *harness) createScreen() screen {
	h.t.Helper()
	res := h.do("POST", "/api/screens", nil, nil)
	if res.status != http.StatusCreated {
		h.t.Fatalf("create screen: %d %s", res.status, res.body)
	}
	return decode[screen](h.t, res)
}

func (h *harness) createSession() session {
	h.t.Helper()
	s := h.createScreen()
	res := h.do("POST", "/api/pair/"+s.Token, nil, nil)
	if res.status != http.StatusCreated {
		h.t.Fatalf("pair: %d %s", res.status, res.body)
	}
	return session{screen: s, phone: decode[pairing](h.t, res)}
}

func expectStatus(t *testing.T, r response, status int) {
	t.Helper()
	if r.status != status {
		t.Fatalf("status = %d, want %d (body %s)", r.status, status, r.body)
	}
}

func expectCode(t *testing.T, r response, status int, code string) {
	t.Helper()
	expectStatus(t, r, status)
	if got := r.json(t)["code"]; got != code {
		t.Fatalf("code = %v, want %q (body %s)", got, code, r.body)
	}
}
