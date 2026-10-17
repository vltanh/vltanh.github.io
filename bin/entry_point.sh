#!/bin/bash
set -euo pipefail

echo "Entry point script running"

CONFIG_FILE=_config.yml
DOCKER_DESTINATION=/tmp/_site
jekyll_pid=
watcher_pid=

cleanup() {
    if [ -n "$watcher_pid" ]; then
        kill "$watcher_pid" 2>/dev/null || true
        wait "$watcher_pid" 2>/dev/null || true
    fi
    if [ -n "$jekyll_pid" ]; then
        kill "$jekyll_pid" 2>/dev/null || true
        wait "$jekyll_pid" 2>/dev/null || true
    fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Function to manage Gemfile.lock
manage_gemfile_lock() {
    git config --global --add safe.directory /srv/jekyll
    if command -v git &> /dev/null && [ -f Gemfile.lock ]; then
        if git ls-files --error-unmatch Gemfile.lock &> /dev/null; then
            echo "Gemfile.lock is tracked by git, keeping it intact"
            git restore Gemfile.lock 2>/dev/null || true
        else
            echo "Gemfile.lock is not tracked by git, removing it"
            rm Gemfile.lock
        fi
    fi
}

ensure_bundle_deps() {
    if bundle check >/dev/null 2>&1; then
        echo "Bundler dependencies already satisfied"
        return
    fi

    echo "Installing missing bundler dependencies"
    bundle install --jobs 4 --retry 3
}

start_jekyll() {
    manage_gemfile_lock
    ensure_bundle_deps
    mkdir -p "$DOCKER_DESTINATION"
    # Use memory caching so host-owned disk cache files cannot block startup.
    bundle exec jekyll serve --watch --port=8080 --host=0.0.0.0 --livereload --verbose --trace --force_polling --disable-disk-cache --destination "$DOCKER_DESTINATION" --config "$CONFIG_FILE" &
    jekyll_pid=$!
}

while true; do
    start_jekyll
    inotifywait -q -e modify,move,create,delete "$CONFIG_FILE" &
    watcher_pid=$!

    # Stop the container if Jekyll fails instead of leaving only the watcher alive.
    if wait -n "$jekyll_pid" "$watcher_pid"; then
        if ! kill -0 "$jekyll_pid" 2>/dev/null; then
            exit 0
        fi
    else
        exit $?
    fi

    echo "Change detected to $CONFIG_FILE, restarting Jekyll"
    watcher_pid=
    kill "$jekyll_pid" 2>/dev/null || true
    wait "$jekyll_pid" 2>/dev/null || true
    jekyll_pid=
done
