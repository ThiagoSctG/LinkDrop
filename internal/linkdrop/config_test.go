package linkdrop_test

import (
	"strings"
	"testing"
	"time"

	"github.com/ThiagoSctG/LinkDrop/internal/linkdrop"
)

func env(values map[string]string) func(string) (string, bool) {
	return func(key string) (string, bool) {
		v, ok := values[key]
		return v, ok
	}
}

func TestConfigFromEnvDefaults(t *testing.T) {
	cfg, addr, err := linkdrop.ConfigFromEnv(env(nil))
	if err != nil {
		t.Fatal(err)
	}
	if addr != ":47821" || cfg.TrustProxy || cfg.PublicURL != "" {
		t.Fatalf("addr %q cfg %+v", addr, cfg)
	}
	if cfg.SessionTTL != 30*time.Minute || cfg.PairingTTL != 2*time.Minute || cfg.MaxItemsPerSession != 100 {
		t.Fatalf("cfg = %+v", cfg)
	}
	if cfg.RateLimit != (linkdrop.RateLimit{Requests: 60, Window: time.Minute, MaxKeys: 10_000}) {
		t.Fatalf("rate limit = %+v", cfg.RateLimit)
	}
}

func TestConfigFromEnvOverrides(t *testing.T) {
	cfg, addr, err := linkdrop.ConfigFromEnv(env(map[string]string{
		"PORT":                  "8080",
		"TRUST_PROXY":           "true",
		"PUBLIC_URL":            "https://drop.example.com",
		"SESSION_TTL":           "45m",
		"PAIRING_TTL":           "90s",
		"RATE_LIMIT_REQUESTS":   "120",
		"RATE_LIMIT_WINDOW":     "30s",
		"RATE_LIMIT_MAX_KEYS":   "50",
		"MAX_ITEMS_PER_SESSION": "20",
	}))
	if err != nil {
		t.Fatal(err)
	}
	want := linkdrop.RateLimit{Requests: 120, Window: 30 * time.Second, MaxKeys: 50}
	if addr != ":8080" || !cfg.TrustProxy || cfg.PublicURL != "https://drop.example.com" || cfg.SessionTTL != 45*time.Minute ||
		cfg.PairingTTL != 90*time.Second || cfg.RateLimit != want || cfg.MaxItemsPerSession != 20 {
		t.Fatalf("addr %q cfg %+v", addr, cfg)
	}
}

func TestConfigFromEnvRejectsInvalidValues(t *testing.T) {
	for key, value := range map[string]string{
		"PORT":                  "70000",
		"TRUST_PROXY":           "maybe",
		"PUBLIC_URL":            "drop.example.com",
		"SESSION_TTL":           "30",
		"PAIRING_TTL":           "-1m",
		"RATE_LIMIT_REQUESTS":   "0",
		"MAX_ITEMS_PER_SESSION": "lots",
		"LOG_LEVEL":             "loud",
	} {
		_, _, err := linkdrop.ConfigFromEnv(env(map[string]string{key: value}))
		if err == nil || !strings.Contains(err.Error(), key) {
			t.Errorf("%s=%q: err = %v", key, value, err)
		}
	}
	if _, _, err := linkdrop.ConfigFromEnv(env(map[string]string{"PORT": "http"})); err == nil {
		t.Error("PORT=http accepted")
	}
}
