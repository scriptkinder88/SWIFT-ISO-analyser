// Command server runs the SWIFT ISO analyser: JSON API, interactive architecture
// map and PowerPoint export. It binds to localhost by default.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/scriptkinder88/swift-iso-analyser/data"
	"github.com/scriptkinder88/swift-iso-analyser/internal/api"
	"github.com/scriptkinder88/swift-iso-analyser/internal/model"
	"github.com/scriptkinder88/swift-iso-analyser/internal/store"
	"github.com/scriptkinder88/swift-iso-analyser/internal/wazuh"
	"github.com/scriptkinder88/swift-iso-analyser/web"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:8080", "indirizzo di ascolto (localhost di default)")
	dataFile := flag.String("data", "var/store.json", "file JSON di persistenza ('' = solo memoria)")
	flag.Parse()

	seed, err := seedDatabase()
	if err != nil {
		log.Fatalf("seed: %v", err)
	}
	st, err := store.Open(*dataFile, seed)
	if err != nil {
		log.Fatalf("store: %v", err)
	}

	wz, err := wazuhFromEnv()
	if err != nil {
		log.Fatalf("wazuh: %v", err)
	}
	if wz == nil {
		log.Print("Wazuh non configurato: sincronizzazione disabilitata")
	}

	srv := &api.Server{Store: st, Wazuh: wz, Web: web.Files()}
	httpSrv := &http.Server{
		Addr:              *addr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      2 * time.Minute,
		IdleTimeout:       60 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = httpSrv.Shutdown(shutdownCtx)
	}()

	log.Printf("in ascolto su http://%s", *addr)
	if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

// seedDatabase builds the first database from the files embedded in the binary.
func seedDatabase() (model.Database, error) {
	var db model.Database
	if err := json.Unmarshal(data.SwiftCSCF, &db.Framework); err != nil {
		return db, fmt.Errorf("framework: %w", err)
	}
	if err := json.Unmarshal(data.SampleArchitecture, &db.Architecture); err != nil {
		return db, fmt.Errorf("sample architecture: %w", err)
	}
	db.Inventory = map[string][]model.InventoryItem{}
	if problems := db.Validate(); len(problems) > 0 {
		return db, fmt.Errorf("invalid seed data: %v", problems)
	}
	return db, nil
}

// wazuhFromEnv reads the Wazuh settings from the environment. Credentials are
// never stored in the repository.
func wazuhFromEnv() (*wazuh.Client, error) {
	url := os.Getenv("WAZUH_URL")
	if url == "" {
		return nil, nil
	}
	return wazuh.New(wazuh.Config{
		BaseURL:  url,
		User:     os.Getenv("WAZUH_USER"),
		Password: os.Getenv("WAZUH_PASSWORD"),
		CAFile:   os.Getenv("WAZUH_CA_FILE"),
	})
}
