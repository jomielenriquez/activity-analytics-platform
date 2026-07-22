package main

import (
	"fmt"
	"os"
	"path/filepath"
)

// exeRelativePath resolves name relative to the running executable's own
// directory, not the current working directory (which varies depending on
// how the agent is launched — double-click, a shortcut, or Windows
// startup). Shared by device.json (device.go) and agent.log (log.go).
func exeRelativePath(name string) (string, error) {
	exePath, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("resolve executable path: %w", err)
	}
	return filepath.Join(filepath.Dir(exePath), name), nil
}
