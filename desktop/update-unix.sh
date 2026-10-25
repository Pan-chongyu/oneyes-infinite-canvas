#!/bin/sh
# All paths are passed as arguments; no shell evaluation of metadata or user paths.
set -eu
kind=$1
parent=$2
destination=$3
source=$4
error_file=$5
executable=$6
ack=$7
backup="${destination}.oneyes-previous"
replaced=0
launch_app() {
    if [ "$kind" = mac ]; then /usr/bin/open -W "$destination" --args --oneyes-updated &
    else nohup "$executable" --oneyes-updated >/dev/null 2>&1 & fi
    launcher=$!
}
failed() {
    trap - EXIT HUP INT TERM
    if [ "$replaced" = 1 ] && [ -e "$backup" ]; then
        rm -rf "$destination"
        mv "$backup" "$destination"
    fi
    printf '%s\n' 'Installation failed' > "$error_file"
    launch_app || true
    exit 1
}
trap failed EXIT HUP INT TERM
while kill -0 "$parent" 2>/dev/null; do sleep 1; done
case "$kind" in
    mac|AppImage)
        # An interrupted previous replacement is never silently discarded.
        test ! -e "$backup"
        mv "$destination" "$backup"
        replaced=1
        mv "$source" "$destination"
        launch_app
        while [ ! -f "$ack" ]; do kill -0 "$launcher" 2>/dev/null; sleep 1; done
        rm -rf "$backup"
        if [ "$kind" = mac ]; then rmdir "$(dirname "$source")"; fi
        ;;
    deb) pkexec dpkg -i "$source"; launch_app ;;
    rpm) pkexec rpm -U --replacepkgs "$source"; launch_app ;;
    *) exit 1 ;;
esac
trap - EXIT HUP INT TERM
