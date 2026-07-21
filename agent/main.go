package main

import "fyne.io/systray"

func main() {
	state := NewAgentState()
	systray.Run(onReady(state), onExit)
}
