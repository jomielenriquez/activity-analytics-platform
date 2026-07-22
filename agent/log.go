package main

import (
	"fmt"
	"log"
	"os"
)

// setupFileLogging redirects the standard logger to LogFileName, resolved
// next to the executable. Called once at startup, before anything else
// logs. Opens in append mode (not truncate) so a log from a previous run
// isn't lost on restart — this is the only record of agent activity now
// that there's no console attached to read it from live. Uses the
// default log flags/format (date, time, message), unchanged from what
// used to print to the console, so nothing about how a log line reads
// needs to change on either side of this switch.
func setupFileLogging() (*os.File, error) {
	path, err := exeRelativePath(LogFileName)
	if err != nil {
		return nil, err
	}

	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return nil, fmt.Errorf("open log file %s: %w", path, err)
	}

	log.SetOutput(f)
	return f, nil
}
