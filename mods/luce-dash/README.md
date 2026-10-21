# luce-dash

A Ferrari Luce inspired telemetry pane for Claude Code: rosso corsa on black
with yellow needles. It opens beside the transcript and shows SPEED (output
tokens per minute), RPM (tool calls per minute), FUEL (context window left,
red-lined under 15 percent), GEAR (the tool running right now), the running
lap timer with last and best turn times, the odometer of total tokens, tool
and error counts, and the session cost when the host reports it.

Usage: the pane opens at session start when the terminal is wide enough;
`/luce` reopens it. The status line shows the last lap time and its tokens.
No setup, no network, no files written.
