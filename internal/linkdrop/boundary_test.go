package linkdrop_test

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/ThiagoSctG/LinkDrop/internal/linkdrop"
)

func countStatuses(responses []response) map[int]int {
	counts := map[int]int{}
	for _, r := range responses {
		counts[r.status]++
	}
	return counts
}

func TestRateLimitIgnoresSpoofedClientHeadersByDefault(t *testing.T) {
	h := newHarness(t)
	var responses []response
	for i := range 61 {
		responses = append(responses, h.do("GET", "/api/health", map[string]string{
			"x-forwarded-for":      fmt.Sprintf("203.0.113.%d", i),
			"x-linkdrop-client-ip": fmt.Sprintf("198.51.100.%d", i),
		}, nil))
	}
	if counts := countStatuses(responses); counts[200] != 60 || counts[429] != 1 {
		t.Fatalf("statuses = %v", counts)
	}
	expectCode(t, responses[60], http.StatusTooManyRequests, "rate_limited")
}

func TestTrustedProxyUsesTheAddressItObserved(t *testing.T) {
	h := newHarness(t, func(c *linkdrop.Config) { c.TrustProxy = true })
	var responses []response
	for i := range 61 {
		// Everything before the last hop is caller-controlled.
		responses = append(responses, h.do("GET", "/api/health", map[string]string{"x-forwarded-for": fmt.Sprintf("203.0.113.%d, 192.0.2.10", i)}, nil))
	}
	if counts := countStatuses(responses); counts[200] != 60 || counts[429] != 1 {
		t.Fatalf("statuses = %v", counts)
	}
	expectStatus(t, h.do("GET", "/api/health", map[string]string{"x-forwarded-for": "192.0.2.11"}, nil), http.StatusOK)
}

func TestRateLimitBoundsIdentitiesAndRecovers(t *testing.T) {
	h := newHarness(t, func(c *linkdrop.Config) {
		c.TrustProxy = true
		c.RateLimit.MaxKeys = 2
	})
	ip := func(last string) map[string]string { return map[string]string{"x-forwarded-for": last} }
	expectStatus(t, h.do("GET", "/api/health", ip("192.0.2.1"), nil), http.StatusOK)
	expectStatus(t, h.do("GET", "/api/health", ip("192.0.2.2"), nil), http.StatusOK)
	expectStatus(t, h.do("GET", "/api/health", ip("192.0.2.3"), nil), http.StatusTooManyRequests)
	h.clock.Advance(time.Minute + time.Second)
	expectStatus(t, h.do("GET", "/api/health", ip("192.0.2.3"), nil), http.StatusOK)
}

func TestRequestBodyIsBounded(t *testing.T) {
	h := newHarness(t)
	sess := h.createSession()
	huge := `{"content":"` + strings.Repeat("x", 1<<20) + `"}`
	expectCode(t, h.addItem(sess, sess.phoneHeaders(), huge), http.StatusRequestEntityTooLarge, "body_too_large")
}

func TestSecurityHeaders(t *testing.T) {
	h := newHarness(t)
	for _, path := range []string{"/api/health", "/"} {
		res := h.do("GET", path, nil, nil)
		want := map[string]string{
			"x-content-type-options": "nosniff",
			"referrer-policy":        "no-referrer",
			"x-frame-options":        "DENY",
		}
		for header, value := range want {
			if got := res.header.Get(header); got != value {
				t.Errorf("%s %s = %q, want %q", path, header, got, value)
			}
		}
		csp := res.header.Get("content-security-policy")
		for _, directive := range []string{"default-src 'self'", "script-src 'self'", "frame-ancestors 'none'"} {
			if !strings.Contains(csp, directive) {
				t.Errorf("%s CSP %q lacks %q", path, csp, directive)
			}
		}
	}
}
