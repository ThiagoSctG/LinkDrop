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
			l.evictOldestLocked()
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

// evictOldestLocked forgets the identity whose window started first, so a full table
// never locks out new clients.
func (l *rateLimiter) evictOldestLocked() {
	var oldest string
	var reset time.Time
	for key, w := range l.windows {
		if oldest == "" || w.reset.Before(reset) {
			oldest, reset = key, w.reset
		}
	}
	delete(l.windows, oldest)
}

func (l *rateLimiter) pruneLocked(now time.Time) {
	for key, w := range l.windows {
		if !now.Before(w.reset) {
			delete(l.windows, key)
		}
	}
}

// rateKey groups IPv6 clients by /64, the block one subscriber usually controls, so
// rotating addresses inside it neither multiplies the limit nor fills the table.
func rateKey(ip string) string {
	addr, err := netip.ParseAddr(ip)
	if err != nil {
		return ip
	}
	addr = addr.Unmap()
	if addr.Is4() {
		return addr.String()
	}
	prefix, err := addr.WithZone("").Prefix(64)
	if err != nil {
		return ip
	}
	return prefix.String()
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
