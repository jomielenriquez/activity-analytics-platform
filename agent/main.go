package main

import "fyne.io/systray"

func main() {
	state := NewAgentState()
	go RunTracker(state)
	systray.Run(onReady(state), onExit)
}
