#!/bin/bash
set -euo pipefail

while getopts b:t:f: option
do
    case "${option}" in
        b)  BOOKTITLE=${OPTARG};;
        t)  TITLE=${OPTARG};;
        f)  FORMAT=${OPTARG};;
        *)  echo "Error: aborting"
        exit 1 ;;
    esac
done

print_pdf=false
print_epub=false
CURDIR=$(pwd)
file="${CURDIR}/data/user.conf"
output_pdf="${CURDIR}/download/pdf"
output_epub="${CURDIR}/download/epub"
run=0
username=""
password=""

if [[ $FORMAT = 'pdf' ]]
then
    echo "Downloading PDF"
    print_pdf=true
elif [[ $FORMAT = 'epub' ]]
then
    echo "Downloading EPUB"
    print_epub=true
elif [[ $FORMAT = 'both' ]]
then
    echo "Downloading both PDF and EPUB"
    print_pdf=true
    print_epub=true
else
    echo "Error: aborting"
    exit 1
fi

if [[ ! -d "$output_pdf" || ! -d "$output_epub" ]];
then
    mkdir -p "$output_pdf"
    mkdir -p "$output_epub"
fi
if [[ ! -f "$file" ]]
then
    echo "Error: user.conf not found"
    exit 1
fi
for line in $(cat $file); do
    if [[ $run = 0 ]]
    then
        username=$line
        run=1
    else
        password=$line
        run=0
    fi
done

BOOK="${CURDIR}/${TITLE}.epub"
(docker run --name "$TITLE" kirinnee/orly:latest login "$BOOKTITLE" "$username":"$password") > "$BOOK"

if [[ "${print_pdf}" = true ]]
then
    ebook-convert "$BOOK" "$TITLE".pdf
    mv "$TITLE" "$output_pdf/$TITLE"
fi

if [[ "${print_epub}" = true ]]
then
    mv "$BOOK" "$output_epub/$BOOK"
elif [[ "${print_epub}" = false ]]
then
    rm "$BOOK"
fi

docker container rm -f "$TITLE"
echo "$BOOKTITLE downloaded successfully"