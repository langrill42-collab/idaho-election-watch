#!/bin/zsh
cd -- "$(dirname -- "$0")"
exec "$HOME/.local/bin/uv" run python app.py --desktop
