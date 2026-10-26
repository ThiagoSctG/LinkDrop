package linkdrop

import (
	"net"
	"net/http"
	"net/netip"
	"strings"
	"sync"
	"time"
)

// rateLimiter is a fixed-window counter per client address with a bounded number of identities.
type rateLimiter struct {
	mu      sync.Mutex
	now     func() time.Time
	limit   RateLimit
	windows map[string]*window
}

type window struct {
	count int
	reset time.Time
}

func newRateLimiter(cfg Config) *rateLimiter {
	return &rateLimiter{now: cfg.Now, limit: cfg.RateLimit, windows: map[string]*window{}}
}

func (l *rateLimiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	w, ok := l.windows[key]
	if ok && !now.Before(w.reset) {
		delete(l.windows, key)
		ok = false
	}
	if !ok {
		if len(l.windows) >= l.limit.MaxKeys {
			l.pruneLocked(now)
		}
		if len(l.windows) >= l.limit.MaxKeys {
			return false
		}
		l.windows[key] = &window{count: 1, reset: now.Add(l.limit.Window)}
		return true
	}
	if w.count >= l.limit.Requests {
		return false
	}
	w.count++
	return true
}

func (l *rateLimiter) prune() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.pruneLocked(l.now())
}

func (l *rateLimiter) pruneLocked(now time.Time) {
	for key, w := range l.windows {
		if !now.Before(w.reset) {
			delete(l.windows, key)
		}
	}
}

// clientIP returns the socket peer, or with trustProxy the address the proxy itself
// appended to X-Forwarded-For. Earlier entries are caller-controlled and ignored.
func clientIP(r *http.Request, trustProxy bool) string {
	peer, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		peer = r.RemoteAddr
	}
	if !trustProxy {
		return peer
	}
	forwarded := strings.Join(r.Header.Values("x-forwarded-for"), ",")
	if i := strings.LastIndex(forwarded, ","); i >= 0 {
		forwarded = forwarded[i+1:]
	}
	if addr, err := netip.ParseAddr(strings.TrimSpace(forwarded)); err == nil {
		return addr.String()
	}
	return peer
}
