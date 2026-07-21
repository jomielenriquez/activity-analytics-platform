package main

import (
	"fmt"
	"path/filepath"
	"unsafe"

	"golang.org/x/sys/windows"
)

// GetForegroundWindow, GetWindowThreadProcessId, OpenProcess,
// QueryFullProcessImageName, and CloseHandle all have typed wrappers in
// golang.org/x/sys/windows. GetWindowTextW, GetLastInputInfo, and
// GetTickCount don't (as of the version pulled in here), so those three
// are loaded directly via NewLazySystemDLL — the same mechanism
// x/sys/windows itself uses internally for the functions it does wrap.
var (
	user32   = windows.NewLazySystemDLL("user32.dll")
	kernel32 = windows.NewLazySystemDLL("kernel32.dll")

	procGetWindowTextW   = user32.NewProc("GetWindowTextW")
	procGetLastInputInfo = user32.NewProc("GetLastInputInfo")
	procGetTickCount     = kernel32.NewProc("GetTickCount")
)

// PROCESS_QUERY_LIMITED_INFORMATION — enough access to read the exe path
// via QueryFullProcessImageName without requesting anything broader.
const processQueryLimitedInformation = 0x1000

// lastInputInfo mirrors the Win32 LASTINPUTINFO struct.
type lastInputInfo struct {
	cbSize uint32
	dwTime uint32 // tick count (GetTickCount units) at last input event
}

// foregroundWindowInfo returns the current foreground window's title and
// the base executable name of the process that owns it (e.g. "chrome.exe",
// not the full path). ok is false when there's nothing to report this
// poll — no foreground window (e.g. a desktop-focus transition) or the
// owning process couldn't be queried (e.g. an elevated/protected process
// this agent doesn't have rights to inspect) — neither is treated as a
// hard error, since it's expected to happen transiently.
func foregroundWindowInfo() (title, exeName string, ok bool) {
	hwnd := windows.GetForegroundWindow()
	if hwnd == 0 {
		return "", "", false
	}

	title = windowTitle(hwnd)

	var pid uint32
	if _, err := windows.GetWindowThreadProcessId(hwnd, &pid); err != nil || pid == 0 {
		return title, "", false
	}

	exeName, err := processExeName(pid)
	if err != nil {
		return title, "", false
	}

	return title, exeName, true
}

func windowTitle(hwnd windows.HWND) string {
	buf := make([]uint16, 512)
	ret, _, _ := procGetWindowTextW.Call(
		uintptr(hwnd),
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(len(buf)),
	)
	if ret == 0 {
		return "" // no title, or the call failed — either way, nothing to show
	}
	return windows.UTF16ToString(buf[:ret])
}

func processExeName(pid uint32) (string, error) {
	handle, err := windows.OpenProcess(processQueryLimitedInformation, false, pid)
	if err != nil {
		return "", fmt.Errorf("OpenProcess: %w", err)
	}
	defer windows.CloseHandle(handle)

	buf := make([]uint16, 1024)
	size := uint32(len(buf))
	if err := windows.QueryFullProcessImageName(handle, 0, &buf[0], &size); err != nil {
		return "", fmt.Errorf("QueryFullProcessImageName: %w", err)
	}

	return filepath.Base(windows.UTF16ToString(buf[:size])), nil
}

// idleSeconds returns how long it's been, system-wide, since the last
// keyboard or mouse input.
func idleSeconds() (float64, error) {
	info := lastInputInfo{cbSize: uint32(unsafe.Sizeof(lastInputInfo{}))}
	ret, _, err := procGetLastInputInfo.Call(uintptr(unsafe.Pointer(&info)))
	if ret == 0 {
		return 0, fmt.Errorf("GetLastInputInfo: %w", err)
	}

	tickCount, _, _ := procGetTickCount.Call()

	// dwTime and GetTickCount() are both 32-bit millisecond counts that
	// wrap around every ~49.7 days. Using GetTickCount() (32-bit) rather
	// than GetTickCount64() specifically so the subtraction stays in
	// uint32, where wraparound is defined, unsigned-modular arithmetic —
	// it keeps producing the correct (small, positive) delta across a
	// rollover instead of a huge bogus one.
	idleMillis := uint32(tickCount) - info.dwTime
	return float64(idleMillis) / 1000, nil
}
