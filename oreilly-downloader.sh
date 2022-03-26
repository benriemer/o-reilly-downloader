#!/bin/bash
set -euo pipefail
DIRECTORY=$(pwd)
while getopts b:t: option
do
    case "${option}" in
        b)  BOOKTITLE=${OPTARG};;
        t)  TITLE=${OPTARG};;
        *)  echo "Error: aborting"
        exit 1 ;;
    esac
done
BOOK="${DIRECTORY}/${TITLE}.epub"
(docker run --name "$TITLE" kirinnee/orly:latest login "$BOOKTITLE" riemer600@gmail.com:xge0NFJ-ruw*jaw9hmn) > "$BOOK"
ebook-convert "$BOOK" "$TITLE".pdf
rm "$BOOK" && docker container rm -f "$TITLE"
echo "$BOOKTITLE downloaded successfully"