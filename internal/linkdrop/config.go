package linkdrop

import (
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config controls a Server. Zero values fall back to the defaults below.
type Config struct {
	Now                func() time.Time
	SessionTTL         time.Duration
	PairingTTL         time.Duration
	SweepInterval      time.Duration
	MaxItemsPerSession int
	RateLimit          RateLimit
	// TrustProxy reads the client address and scheme from X-Forwarded-* headers.
	TrustProxy bool
	// PublicURL is the external origin used to build pairing links, e.g. https://drop.example.com.
	PublicURL string
	// Assets holds the built frontend (index.html at its root). Nil serves a placeholder page.
	Assets fs.FS
	Logger *slog.Logger
}

type RateLimit struct {
	Requests int
	Window   time.Duration
	MaxKeys  int
}

const (
	DefaultSessionTTL         = 30 * time.Minute
	DefaultPairingTTL         = 2 * time.Minute
	DefaultSweepInterval      = 15 * time.Second
	DefaultMaxItemsPerSession = 100
	DefaultRateLimitRequests  = 60
	DefaultRateLimitWindow    = time.Minute
	DefaultRateLimitMaxKeys   = 10_000
)

func (c Config) withDefaults() Config {
	if c.Now == nil {
		c.Now = time.Now
	}
	if c.SessionTTL <= 0 {
		c.SessionTTL = DefaultSessionTTL
	}
	if c.PairingTTL <= 0 {
		c.PairingTTL = DefaultPairingTTL
	}
	if c.SweepInterval <= 0 {
		c.SweepInterval = DefaultSweepInterval
	}
	if c.MaxItemsPerSession <= 0 {
		c.MaxItemsPerSession = DefaultMaxItemsPerSession
	}
	if c.RateLimit.Requests <= 0 {
		c.RateLimit.Requests = DefaultRateLimitRequests
	}
	if c.RateLimit.Window <= 0 {
		c.RateLimit.Window = DefaultRateLimitWindow
	}
	if c.RateLimit.MaxKeys <= 0 {
		c.RateLimit.MaxKeys = DefaultRateLimitMaxKeys
	}
	if c.Logger == nil {
		c.Logger = slog.Default()
	}
	return c
}

// ConfigFromEnv reads the documented environment variables. It returns the listen
// address separately because it belongs to the process, not to the handler.
func ConfigFromEnv(lookup func(string) (string, bool)) (Config, string, error) {
	cfg := Config{}.withDefaults()
	p := envParser{lookup: lookup}
	port := p.int("PORT", 3000)
	if port > 65535 {
		p.fail("PORT", strconv.Itoa(port), "a TCP port up to 65535")
	}
	cfg.TrustProxy = p.bool("TRUST_PROXY")
	cfg.PublicURL = p.publicURL("PUBLIC_URL")
	cfg.SessionTTL = p.duration("SESSION_TTL", cfg.SessionTTL)
	cfg.PairingTTL = p.duration("PAIRING_TTL", cfg.PairingTTL)
	cfg.RateLimit.Requests = p.int("RATE_LIMIT_REQUESTS", cfg.RateLimit.Requests)
	cfg.RateLimit.Window = p.duration("RATE_LIMIT_WINDOW", cfg.RateLimit.Window)
	cfg.RateLimit.MaxKeys = p.int("RATE_LIMIT_MAX_KEYS", cfg.RateLimit.MaxKeys)
	cfg.MaxItemsPerSession = p.int("MAX_ITEMS_PER_SESSION", cfg.MaxItemsPerSession)
	level := p.logLevel("LOG_LEVEL")
	if err := errors.Join(p.errs...); err != nil {
		return Config{}, "", err
	}
	cfg.Logger = slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: level}))
	return cfg, ":" + strconv.Itoa(port), nil
}

type envParser struct {
	lookup func(string) (string, bool)
	errs   []error
}

func (p *envParser) get(key string) (string, bool) {
	value, ok := p.lookup(key)
	value = strings.TrimSpace(value)
	return value, ok && value != ""
}

func (p *envParser) fail(key, value, want string) {
	p.errs = append(p.errs, fmt.Errorf("%s=%q: expected %s", key, value, want))
}

func (p *envParser) int(key string, fallback int) int {
	value, ok := p.get(key)
	if !ok {
		return fallback
	}
	n, err := strconv.Atoi(value)
	if err != nil || n <= 0 {
		p.fail(key, value, "a positive integer")
		return fallback
	}
	return n
}

func (p *envParser) duration(key string, fallback time.Duration) time.Duration {
	value, ok := p.get(key)
	if !ok {
		return fallback
	}
	d, err := time.ParseDuration(value)
	if err != nil || d <= 0 {
		p.fail(key, value, "a positive duration such as 30m or 90s")
		return fallback
	}
	return d
}

func (p *envParser) bool(key string) bool {
	value, ok := p.get(key)
	if !ok {
		return false
	}
	b, err := strconv.ParseBool(value)
	if err != nil {
		p.fail(key, value, "true or false")
	}
	return b
}

func (p *envParser) publicURL(key string) string {
	value, ok := p.get(key)
	if !ok {
		return ""
	}
	u, err := url.Parse(value)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		p.fail(key, value, "an absolute http(s) URL")
		return ""
	}
	return value
}

func (p *envParser) logLevel(key string) slog.Level {
	value, ok := p.get(key)
	if !ok {
		return slog.LevelInfo
	}
	var level slog.Level
	if err := level.UnmarshalText([]byte(value)); err != nil {
		p.fail(key, value, "debug, info, warn or error")
	}
	return level
}
