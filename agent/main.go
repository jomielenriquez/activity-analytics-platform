package main

import "github.com/getlantern/systray"

func main() {
	state := NewAgentState()
	systray.Run(onReady(state), onExit)
}
