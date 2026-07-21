package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

var httpClient = &http.Client{Timeout: 10 * time.Second}

type registerRequest struct {
	DeviceName     string `json:"device_name"`
	OS             string `json:"os"`
	UserIdentifier string `json:"user_identifier"`
}

type registerResponse struct {
	DeviceID string `json:"device_id"`
	APIKey   string `json:"api_key"`
}

// registerDevice calls POST /api/v1/devices/register once. No auth — this
// endpoint is intentionally open (see DESIGN.md's known limitations).
func registerDevice(deviceName, osName, userIdentifier string) (*DeviceCredentials, error) {
	reqBody, err := json.Marshal(registerRequest{
		DeviceName:     deviceName,
		OS:             osName,
		UserIdentifier: userIdentifier,
	})
	if err != nil {
		return nil, fmt.Errorf("encode register request: %w", err)
	}

	resp, err := httpClient.Post(BackendURL+"/api/v1/devices/register", "application/json", bytes.NewReader(reqBody))
	if err != nil {
		return nil, fmt.Errorf("register request failed: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusCreated {
		return nil, fmt.Errorf("register failed: %s (%s)", resp.Status, string(body))
	}

	var parsed registerResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("decode register response: %w", err)
	}

	return &DeviceCredentials{DeviceID: parsed.DeviceID, APIKey: parsed.APIKey}, nil
}

type eventPayload struct {
	ClientSegmentID string  `json:"client_segment_id"`
	Type            string  `json:"type"`
	AppName         *string `json:"app_name,omitempty"`
	WindowTitle     *string `json:"window_title,omitempty"`
	StartedAt       string  `json:"started_at"`
	EndedAt         string  `json:"ended_at"`
	DurationSeconds int     `json:"duration_seconds"`
}

type eventsRequest struct {
	AgentStatus string         `json:"agent_status"`
	Events      []eventPayload `json:"events"`
}

type eventsResponse struct {
	Accepted   int `json:"accepted"`
	Duplicates int `json:"duplicates"`
}

// postEvents calls POST /api/v1/events with whatever's currently queued
// (an empty slice is valid — it's still a heartbeat). app_name/
// window_title are left as nil (omitted from the JSON) for idle segments,
// since the backend rejects "" as neither absent nor null.
func postEvents(creds *DeviceCredentials, agentStatus string, segments []Segment) (accepted, duplicates int, err error) {
	events := make([]eventPayload, len(segments))
	for i, seg := range segments {
		ev := eventPayload{
			ClientSegmentID: seg.ClientSegmentID,
			Type:            seg.Type,
			StartedAt:       seg.StartedAt.UTC().Format(time.RFC3339),
			EndedAt:         seg.EndedAt.UTC().Format(time.RFC3339),
			DurationSeconds: seg.DurationSeconds,
		}
		if seg.Type == "active" {
			ev.AppName = &seg.AppName
			ev.WindowTitle = &seg.WindowTitle
		}
		events[i] = ev
	}

	reqBody, err := json.Marshal(eventsRequest{AgentStatus: agentStatus, Events: events})
	if err != nil {
		return 0, 0, fmt.Errorf("encode events request: %w", err)
	}

	req, err := http.NewRequest(http.MethodPost, BackendURL+"/api/v1/events", bytes.NewReader(reqBody))
	if err != nil {
		return 0, 0, fmt.Errorf("build events request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+creds.APIKey)

	resp, err := httpClient.Do(req)
	if err != nil {
		return 0, 0, fmt.Errorf("events request failed: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusAccepted {
		return 0, 0, fmt.Errorf("events post failed: %s (%s)", resp.Status, string(body))
	}

	var parsed eventsResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return 0, 0, fmt.Errorf("decode events response: %w", err)
	}

	return parsed.Accepted, parsed.Duplicates, nil
}
