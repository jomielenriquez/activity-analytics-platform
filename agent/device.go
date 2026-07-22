package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"os/user"
)

// DeviceCredentials is what gets persisted to DeviceConfigFileName and
// what's needed to authenticate as this device against POST /events.
type DeviceCredentials struct {
	DeviceID string `json:"device_id"`
	APIKey   string `json:"api_key"`
}

func deviceConfigPath() (string, error) {
	return exeRelativePath(DeviceConfigFileName)
}

// loadOrRegisterDevice loads persisted credentials if they exist and look
// valid; otherwise it registers a new device and persists the result. A
// registration failure here is not fatal to the caller — see sender.go,
// which retries this on later heartbeat ticks so a backend that's briefly
// unreachable at startup doesn't require restarting the agent.
func loadOrRegisterDevice() (*DeviceCredentials, error) {
	path, err := deviceConfigPath()
	if err != nil {
		return nil, err
	}

	if creds, err := loadDeviceCredentials(path); err == nil {
		log.Printf("[device] loaded existing credentials from %s (device_id=%s)", path, creds.DeviceID)
		return creds, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		log.Printf("[device] %s unreadable, will re-register: %v", path, err)
	}

	deviceName := localDeviceName()
	userIdentifier := localUserIdentifier()
	log.Printf("[device] no stored credentials — registering as device_name=%s user_identifier=%s", deviceName, userIdentifier)

	creds, err := registerDevice(deviceName, "windows", userIdentifier)
	if err != nil {
		return nil, fmt.Errorf("register device: %w", err)
	}

	if err := saveDeviceCredentials(path, creds); err != nil {
		// Not fatal: we still have valid in-memory credentials for this
		// run, we just won't find them on disk next run and will
		// re-register then too. Worth a loud log, not worth crashing over.
		log.Printf("[device] registered device_id=%s but failed to save to %s: %v — will re-register on next run", creds.DeviceID, path, err)
	} else {
		log.Printf("[device] registered new device_id=%s, saved to %s", creds.DeviceID, path)
	}

	return creds, nil
}

func loadDeviceCredentials(path string) (*DeviceCredentials, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var creds DeviceCredentials
	if err := json.Unmarshal(data, &creds); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	if creds.DeviceID == "" || creds.APIKey == "" {
		return nil, fmt.Errorf("%s is missing device_id or api_key", path)
	}

	return &creds, nil
}

func saveDeviceCredentials(path string, creds *DeviceCredentials) error {
	data, err := json.MarshalIndent(creds, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o600)
}

func localDeviceName() string {
	name, err := os.Hostname()
	if err != nil || name == "" {
		return "unknown-device"
	}
	return name
}

func localUserIdentifier() string {
	if u, err := user.Current(); err == nil && u.Username != "" {
		return u.Username
	}
	if v := os.Getenv("USERNAME"); v != "" {
		return v
	}
	return "unknown-user"
}
