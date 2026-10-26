// Command linkdrop serves LinkDrop: temporary link and text sharing between a screen
// and a phone paired by QR code.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/ThiagoSctG/LinkDrop/internal/linkdrop"
	"github.com/ThiagoSctG/LinkDrop/web"
)

// version is set at build time with -ldflags "-X main.version=...".
var version = "dev"

func main() {
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		os.Exit(healthcheck())
	}
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	cfg, addr, err := linkdrop.ConfigFromEnv(os.LookupEnv)
	if err != nil {
		return fmt.Errorf("invalid configuration:\n%w", err)
	}
	cfg.Assets = web.Assets()
	if cfg.Assets == nil {
		cfg.Logger.Warn("frontend not embedded; run `npm run build` before `go build`")
	}
	app := linkdrop.New(cfg)
	server := &http.Server{
		Addr:              addr,
		Handler:           app,
		ReadHeaderTimeout: 10 * time.Second,
		ErrorLog:          slog.NewLogLogger(cfg.Logger.Handler(), slog.LevelWarn),
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	serveErr := make(chan error, 1)
	go func() { serveErr <- server.ListenAndServe() }()
	cfg.Logger.Info("LinkDrop listening", "version", version, "addr", addr, "trust_proxy", cfg.TrustProxy)

	select {
	case err := <-serveErr:
		return err
	case <-ctx.Done():
	}
	cfg.Logger.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	// The app goes first: it tells every realtime connection that its session ended,
	// which http.Server.Shutdown cannot do because WebSockets are hijacked.
	if err := app.Shutdown(shutdownCtx); err != nil {
		cfg.Logger.Warn("realtime connections did not close in time", "error", err)
	}
	if err := server.Shutdown(shutdownCtx); err != nil && !errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	return nil
}

// healthcheck lets minimal container images probe the server without curl.
func healthcheck() int {
	port := os.Getenv("PORT")
	if port == "" {
		port = fmt.Sprint(linkdrop.DefaultPort)
	}
	client := http.Client{Timeout: 3 * time.Second}
	res, err := client.Get("http://127.0.0.1:" + port + "/api/health")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		fmt.Fprintln(os.Stderr, "health status", res.StatusCode)
		return 1
	}
	return 0
}
