---
tags:
- C++
description: What it's like trying to be security conscious while working in C++.
---
# A tale of C/C++ development in three parts

Here's what it's like doing C++ development. I am writing a C++ application called
[Subdoc](https://github.com/chromium/subspace/tree/main/subdoc). It has
to be in C++ because it has an important C++ dependency: [Clang](https://clang.llvm.org/).

I would write it in Rust if it were easy to use Clang from Rust, but alas interop is not at that
point.

# Part One: Finding Greatness

To generate html comments from markdown needs a markdown parser. So I hunted the internets and found
[md4c](https://github.com/mity/md4c/).

What does the README have to say about it:
* It is very fast.
* It is easy to integrate into your application.
* It is used by large projects who you'd expect to vet their dependencies, like [Qt](https://www.qt.io/).

So I integrate md4c into Subdoc, and yes it's quite easy to do so and it works great!

# Part Two: Trouble

I want to add some extensions to m4dc for Subdoc, so that I can generate headers as links to
themselves, like you'd see on GitHub. To do that, md4c needs to provide additional signal to
md4c-html, and md4c-html needs some additional callbacks.

So I go looking through the [issue tracker](https://github.com/mity/md4c/issues) to see what others
are doing.

And I find an issue near the top: ["Project Dead?"](https://github.com/mity/md4c/issues/192). Folks
talk about trying to reach the developer on Twitter and that he has disappeared from development.

There are many forks of the project but none appear to be active. So the codebase is essentially
dead in the water, abandonware. You get what you get.

So I fork and add some extensions to the project for my needs, and it's working great.

# Part Three: The C/C++ Securty Wow Factor

I look a little more in the issue tracker, and I find:
* [Array out-of-bounds access leads to segmentation fault in md_build_attribute function](https://github.com/mity/md4c/issues/196)
* [Invalid size passed to memcpy in md_process_inlines](https://github.com/mity/md4c/issues/195)
* [Valgrind error: "Conditional jump or move depends on uninitialised value(s)](https://github.com/mity/md4c/issues/176)

And a pull request titled ["Update md4c.c"](https://github.com/mity/md4c/pull/185) which is fixing
at least three more memory safety bugs.

So there's at least 4 memory safety bugs in this piece of software. It's kinda widely used. And
now malicious markdown could compromise machines through Subdoc or other consumers of this library,
if those bugs can be triggered with the flags they use. I was able to reproduce a timeout but not
the OOB bugs so far.

md4c is written in C not in C++. But the reason I am using it is because
*I am working in C++*. Otherwise I would be looking at the
[markdown](https://docs.rs/markdown/1.0.0-alpha.12/markdown/index.html) crate library.

# The bugs

What kinds of bugs are they?
* One is using an error code as an index into an array. Oops.
* The rest appear to be many occurances of integer overflow when subtracting two signed values and
  then using them as an unsigned value. Classic stuff.

So I have added a whole lot of asserts into the library to try prevent this. To actually feel safe
I would need to turn it into C++ and apply
[Subspace numerics](https://danakj.github.io/subspace-docs/sus-num.html) which would properly catch
bad values at runtime from malicious inputs.

This is how C++ is going right now.