package linkdrop

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Server is the complete LinkDrop HTTP handler: API, realtime channel and frontend.
type Server struct {
	cfg     Config
	store   *store
	limiter *rateLimiter
	mux     *http.ServeMux
	stop    chan struct{}

	// realtime connections are hijacked, so http.Server.Shutdown does not wait for
	// them; the Server tracks them itself to flush their final message.
	connsMu  sync.Mutex
	closing  bool
	conns    sync.WaitGroup
	shutdown sync.Once
}

const maxBodyBytes = 1 << 20

const contentSecurityPolicy = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
	"connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"

func New(cfg Config) *Server {
	cfg = cfg.withDefaults()
	s := &Server{cfg: cfg, store: newStore(cfg), limiter: newRateLimiter(cfg), mux: http.NewServeMux(), stop: make(chan struct{})}
	s.routes()
	go s.sweepLoop()
	return s
}

// Shutdown stops background work, ends every open session and waits until each
// realtime connection has told its endpoint why, or until ctx is done. State lives
// only in memory, so a restart always ends sessions. It is safe to call more than once.
func (s *Server) Shutdown(ctx context.Context) error {
	s.shutdown.Do(func() {
		s.connsMu.Lock()
		s.closing = true
		s.connsMu.Unlock()
		close(s.stop)
		s.store.shutdown()
	})
	done := make(chan struct{})
	go func() {
		s.conns.Wait()
		close(done)
	}()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// trackConn registers a realtime connection, refusing new ones once shutting down.
func (s *Server) trackConn() bool {
	s.connsMu.Lock()
	defer s.connsMu.Unlock()
	if s.closing {
		return false
	}
	s.conns.Add(1)
	return true
}

func (s *Server) sweepLoop() {
	ticker := time.NewTicker(s.cfg.SweepInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			s.store.sweep()
			s.limiter.prune()
		case <-s.stop:
			return
		}
	}
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	s.mux.HandleFunc("POST /api/screens", s.createScreen)
	s.mux.HandleFunc("POST /api/pair/{token}", s.pair)
	s.mux.HandleFunc("GET /api/pair/{token}", s.pairingState)
	s.mux.HandleFunc("GET /api/sessions/{id}", s.sessionView)
	s.mux.HandleFunc("POST /api/sessions/{id}/pairing", s.createRejoinPairing)
	s.mux.HandleFunc("POST /api/sessions/{id}/items", s.addItem)
	s.mux.HandleFunc("DELETE /api/sessions/{id}/items/{itemId}", s.sessionAction(func(id, key string, r *http.Request) *apiError {
		return s.store.removeItem(id, key, r.PathValue("itemId"))
	}))
	s.mux.HandleFunc("POST /api/sessions/{id}/clear", s.sessionAction(func(id, key string, r *http.Request) *apiError {
		return s.store.clear(id, key)
	}))
	s.mux.HandleFunc("POST /api/sessions/{id}/activity", s.sessionAction(func(id, key string, r *http.Request) *apiError {
		return s.store.touch(id, key)
	}))
	s.mux.HandleFunc("POST /api/sessions/{id}/end", s.sessionAction(func(id, key string, r *http.Request) *apiError {
		return s.store.end(id, key)
	}))
	s.mux.HandleFunc("GET /api/realtime", s.realtime)
	s.mux.HandleFunc("/", s.frontend)
	s.mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) { writeError(w, errNotFound) })
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	defer func() {
		if v := recover(); v != nil {
			if v == http.ErrAbortHandler {
				panic(v)
			}
			s.cfg.Logger.Error("request panicked", "method", r.Method, "error", v)
			writeError(w, errInternal)
		}
	}()
	header := w.Header()
	header.Set("x-content-type-options", "nosniff")
	header.Set("referrer-policy", "no-referrer")
	header.Set("x-frame-options", "DENY")
	header.Set("content-security-policy", contentSecurityPolicy)
	if strings.HasPrefix(r.URL.Path, "/api/") {
		if !s.limiter.allow(clientIP(r, s.cfg.TrustProxy)) {
			writeError(w, errRateLimited)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	}
	s.mux.ServeHTTP(w, r)
}

func (s *Server) createScreen(w http.ResponseWriter, r *http.Request) {
	s.writePairing(w, r, s.store.createScreen())
}

func (s *Server) createRejoinPairing(w http.ResponseWriter, r *http.Request) {
	pairing, err := s.store.createRejoinPairing(r.PathValue("id"), endpointKey(r))
	if err != nil {
		writeError(w, err)
		return
	}
	s.writePairing(w, r, pairing)
}

// writePairing sends a new Pairing token along with the URL its QR code encodes.
func (s *Server) writePairing(w http.ResponseWriter, r *http.Request, pairing newPairing) {
	writeJSON(w, http.StatusCreated, struct {
		newPairing
		PairingURL string `json:"pairingUrl"`
	}{pairing, s.origin(r) + "/pair/" + pairing.Token})
}

func (s *Server) pair(w http.ResponseWriter, r *http.Request) {
	phone, err := s.store.pair(r.PathValue("token"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, phone)
}

func (s *Server) pairingState(w http.ResponseWriter, r *http.Request) {
	state, err := s.store.pairingState(r.PathValue("token"), endpointKey(r))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, state)
}

func (s *Server) sessionView(w http.ResponseWriter, r *http.Request) {
	view, err := s.store.view(r.PathValue("id"), endpointKey(r))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, view)
}

func (s *Server) addItem(w http.ResponseWriter, r *http.Request) {
	id, key := r.PathValue("id"), endpointKey(r)
	if err := s.store.authorize(id, key); err != nil {
		writeError(w, err)
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			w.Header().Set("connection", "close")
			writeError(w, errBodyTooLarge)
			return
		}
		writeError(w, errInvalidRequest)
		return
	}
	d, apiErr := parseDraft(body)
	if apiErr != nil {
		writeError(w, apiErr)
		return
	}
	item, apiErr := s.store.addItem(id, key, d)
	if apiErr != nil {
		writeError(w, apiErr)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

// sessionAction wraps a mutation that answers 204 on success.
func (s *Server) sessionAction(act func(id, key string, r *http.Request) *apiError) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := act(r.PathValue("id"), endpointKey(r), r); err != nil {
			writeError(w, err)
			return
		}
		w.Header().Set("cache-control", "no-store")
		w.WriteHeader(http.StatusNoContent)
	}
}

func endpointKey(r *http.Request) string { return r.Header.Get("x-endpoint-key") }

// origin is the external base URL used in pairing links.
func (s *Server) origin(r *http.Request) string {
	if s.cfg.PublicURL != "" {
		return strings.TrimRight(s.cfg.PublicURL, "/")
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	if s.cfg.TrustProxy {
		if proto := r.Header.Get("x-forwarded-proto"); proto == "http" || proto == "https" {
			scheme = proto
		}
	}
	return scheme + "://" + r.Host
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("content-type", "application/json")
	w.Header().Set("cache-control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, err *apiError) {
	writeJSON(w, err.Status, err)
}
