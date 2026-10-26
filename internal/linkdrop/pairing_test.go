package linkdrop_test

import (
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ThiagoSctG/LinkDrop/internal/linkdrop"
)

func TestHealth(t *testing.T) {
	h := newHarness(t)
	res := h.do("GET", "/api/health", nil, nil)
	expectStatus(t, res, http.StatusOK)
	if res.json(t)["status"] != "ok" {
		t.Fatalf("body = %s", res.body)
	}
}

func TestScreenGetsOpaqueTokenAndPairingURL(t *testing.T) {
	h := newHarness(t)
	s := h.createScreen()
	if len(s.Token) < 32 || len(s.ScreenKey) < 32 || s.Token == s.ScreenKey {
		t.Fatalf("weak identifiers: %+v", s)
	}
	if s.PairingURL != h.server.URL+"/pair/"+s.Token {
		t.Fatalf("pairingUrl = %q", s.PairingURL)
	}
	if s.ExpiresAt != "2026-07-09T10:02:00Z" {
		t.Fatalf("expiresAt = %q", s.ExpiresAt)
	}
}

func TestPublicURLOverridesRequestHost(t *testing.T) {
	h := newHarness(t, func(c *linkdrop.Config) { c.PublicURL = "https://drop.example.com/" })
	if got := h.createScreen().PairingURL; !strings.HasPrefix(got, "https://drop.example.com/pair/") {
		t.Fatalf("pairingUrl = %q", got)
	}
}

func TestExpiredOrUnknownQRCannotBeUsed(t *testing.T) {
	h := newHarness(t)
	s := h.createScreen()
	h.clock.Advance(2*time.Minute + time.Second)
	res := h.do("POST", "/api/pair/"+s.Token, nil, nil)
	expectCode(t, res, http.StatusGone, "qr_expired")
	if res.header.Get("cache-control") != "no-store" {
		t.Fatalf("cache-control = %q", res.header.Get("cache-control"))
	}
	expectCode(t, h.do("POST", "/api/pair/does-not-exist", nil, nil), http.StatusGone, "qr_expired")
}

func TestConcurrentScansPairExactlyOnePhone(t *testing.T) {
	h := newHarness(t)
	s := h.createScreen()
	statuses := make([]int, 8)
	var wg sync.WaitGroup
	for i := range statuses {
		wg.Add(1)
		go func() {
			defer wg.Done()
			statuses[i] = h.do("POST", "/api/pair/"+s.Token, nil, nil).status
		}()
	}
	wg.Wait()
	created, conflicts := 0, 0
	for _, status := range statuses {
		switch status {
		case http.StatusCreated:
			created++
		case http.StatusConflict:
			conflicts++
		}
	}
	if created != 1 || conflicts != len(statuses)-1 {
		t.Fatalf("statuses = %v", statuses)
	}
}

func TestPhoneReceivesItsOwnCredentials(t *testing.T) {
	h := newHarness(t)
	sess := h.createSession()
	if sess.phone.Role != "phone" || sess.phone.EndpointKey == "" || sess.phone.EndpointKey == sess.screen.ScreenKey {
		t.Fatalf("pairing = %+v", sess.phone)
	}
	res := h.do("POST", "/api/pair/"+sess.screen.Token, nil, nil)
	expectCode(t, res, http.StatusConflict, "qr_used")
}

func TestScreenLearnsAboutPairingWithItsKeyOnly(t *testing.T) {
	h := newHarness(t)
	s := h.createScreen()
	waiting := h.do("GET", "/api/pair/"+s.Token, map[string]string{"x-endpoint-key": s.ScreenKey}, nil)
	expectStatus(t, waiting, http.StatusOK)
	if waiting.json(t)["status"] != "waiting" {
		t.Fatalf("body = %s", waiting.body)
	}
	expectCode(t, h.do("GET", "/api/pair/"+s.Token, map[string]string{"x-endpoint-key": "intruder"}, nil), http.StatusForbidden, "forbidden")

	phone := decode[pairing](t, h.do("POST", "/api/pair/"+s.Token, nil, nil))
	paired := h.do("GET", "/api/pair/"+s.Token, map[string]string{"x-endpoint-key": s.ScreenKey}, nil).json(t)
	if paired["status"] != "paired" || paired["sessionId"] != phone.SessionID || paired["endpointKey"] != s.ScreenKey || paired["role"] != "screen" {
		t.Fatalf("paired = %v", paired)
	}
}
