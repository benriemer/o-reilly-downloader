<p align="center">
  <a href="" rel="noopener">
 <img width=200px height=200px src="https://www.codegrepper.com/profile_images/577485_lnuxr2sSE6gZJmlrr5h9oITqE8lUbMPCpaFSel94VRGDIK8N5Zbthqn.png" alt="Project logo"></a>
</p>

<h1 align="center">O-Reilly-Downloader 2022</h1>
<br>
<br>
<div align="center">

[![Status](https://img.shields.io/badge/status-active-success.svg)]()
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](/LICENSE)
<br>

</div>

---

<p align="center"> simple cli to download e-books from o'reilly learning plattform to your filesystem as pdf
    <br> 
</p>
<br> 
<br> 
<br> 

## 📝 Table of Contents

- [About](#about)
- [Getting Started](#getting_started)
- [Perequisites](#perequisites)
- [Initial Setup](#initial_setup)
- [What Username/Password needed?](#username_password)
- [Installing](install)
- [Special Thanks](special_thanks)
- [Authors](#authors)

<br><br>

## 🧐 About <a name = "about"></a>

A fast and simple CLI shell script to download e-book as pdf from https://learning.oreilly.com/
<br><br>
## 🏁 Getting Started <a name = "getting_started"></a>

Download the script and save it in the directory where you want to save the downloaded e-book.

Start your terminal shell and execute the following command:
```bash
bash oreilly-downloader.sh -b <book-number> -t <book-title>
```
**book-number** (-b): You can find the book number in the url as shown in the picture below.
![alt text](./screenshot.png)

**book-title** (-t): You can name the pdf as you want. The book title must be spelled without spaces. Like *designing_react_hooks_the_right_way*

You dont have to specify or provide a file extension
<br><br>
## Prerequisites <a name = "perequisites"></a>

You have to options to provide credentials for o reilly learning plattform to the script.

- Docker
- O'Reilly Subscription
- calibre 
*For Mac:* 
```shell
brew install calibre
```
for further instructions or other OS
[Calibre Homepage](https://calibre-ebook.com/)
<br><br>
## Initial Setup <a name = "initial_setup"></a>

Make sure to register and sign up for a account at [O'Reilly Learning Website](https://learning.oreilly.com/)

You can create a test account and fully use this cli.

**Note:**
*Please make sure to not violate any restrictions or rules from O'Reilly Learning Website*
<br><br>
## Username/password login <a name = "username_password"></a>

First, find a book in O'Reilly Learning. Here I picked the famous `Art of Computer Programming` by Knuth,
you can find it at [https://learning.oreilly.com/library/view/art-of-computer/9780321635754/](https://learning.oreilly.com/library/view/art-of-computer/9780321635754/).

Copy the ID of the book (in this case `9780321635754`)

And then run following command in the directory where you download the script

```sh
bash oreilly-downloader.sh -b `9780321635754` -t art-of-computer -f pdf || epub || both 
```
*only one argument is required to set data type*
<br>

| syntax  | argument  | explanation                                                         | example                       
| ----------------|------------- | ------------------------------------------------------------------- | ----------------------------- |
| `book id`   | `-b`| the ID of the book                                                  | `9780321635754`               |
| `title`    | `-t` | the title of the book - you can use every title you want. Please make sure to not use spaces | `art-of-computer`   |
| `print-as`    | `-f` | what format you want the book: epub -> pdf -> both | `art-of-computer`   |
<br><br>
## Installing <a name = "installing"></a>

A step by step series of examples that tell you how to get the script ready.

Be sure you have Docker installed and running

Be sure you have calibre installed and the cli
```sh
# test calibre cli with
ebook-convert --version
# shell output
ebook-convert (calibre 5.39.1)
#Created by: Kovid Goyal <kovid@kovidgoyal.net>
```

Make sure you set-up your account at o'reilly. Then open `user.conf.sample` file with text editor (vim, nano, code) and insert your username and password or:

```sh
echo "your-username" >> user.conf.sample
echo "your-password" >> user.conf.sample
```
Then move the file to `data` directory. Please vaidate you have a directory called data or create a new one

```sh
mkdir -p data
mv user.conf.sample data/user.conf
```


### Downloading every book by executing following command: ###

```sh
bash oreilly-downloader.sh -b `9780321635754` -t art-of-computer -f pdf || epub || both
```
<br>
<br>
<br>

## Acknowledgment <a name = "special_thanks"></a>
## 🎉 Specials Thanks to these people

- [Kirin nee](https://github.com/kirinnee) [for the Dockerfile which is used](https://github.com/kirinnee/oreilly-downloader)
- [Calibre Project](https://calibre-ebook.com/get-involved)

<br>

## ✍️ Authors <a name = "authors"></a>

- [@benriemer](https://github.com/benriemer)
