Today I want to talk about why I am doing the [Subspace](https://github.chromium/subspace)
experiment and where I see it going. The ultimate goal is memory safety in C++, which has
become quite the hot topic in the last few months.

This is probably going to be a bit of a walk through cor3ntin's fantastic
[recent post on C++ safety](https://cor3ntin.github.io/posts/safety/#a-cakewalk-and-eating-it-too).
I agree with a lot of it, and disagree with some of it, and I recommend reading
that first if you haven't!

But I feel like to understand Subspace where is going, it's helpful to also
understand how it began, and what else was tried first. So let's start there.

(Disclaimer: This post is full of opinions, 100% of which are mine and do not represent
my employer, my colleagues or possible anyone else.)

## The land before space-time

I started the Subspace experiment on May 6, 2022. Well, that was [the first
commit](https://github.com/chromium/subspace/commit/0f2eb43884f86ff8bebda3cad0d9390dc8804993), 
however I actually started this experiment in 2021. The Chromium project was
seeing an ever increasing number of [memory
safety](https://arxiv.org/pdf/1705.07354.pdf) bugs in C++ and was looking for
answers.

- Rust had been proposed in the previous year as a way forward but was
turned down in the summer of 2020, with the conclusion "we don't recommend
proceeding with the proposal at this time".
- [MiraclePtr](https://docs.google.com/document/d/1pnnOAIz_DMWDI4oIOFoMAqLnf_MZ2GsrJNb_dbQ3ZBg/edit)
was being iterated on, and it was both unclear if it would make it to production,
and clear it was not a complete answer to all memory safety problems or use-after-frees in C++.
- Chrome Security was [enumerating Undefined Behaviour](https://docs.google.com/document/u/1/d/e/2PACX-1vRZr-HJcYmf2Y76DhewaiJOhRNpjGHCxliAQTBhFxzv1QTae9o8mhBmDl32CRIuaWZLt5kVeH9e9jXv/pub)
in C++ and documenting what was being done so far. It tells the story of a
thousand plugs trying to stop a ship from sinking. But there's no coherent story, and
the ship keeps sinking.

So at the start of 2021, I was given the small task of "figure out memory safety
for Chromium", and off I went.

My first study was of what minimal changes would be required in the C++ language
to get _guarantees_ of lifetime safety at runtime for all stack and heap objects.
I called this work "Boring Pointers" in the spirit of BoringSSL, and I should
work to put this into the public domain. I had no experience working with WG21,
nor awareness of how things worked at the C++ committee level. However, I came to
learn that while the changes to the language were somewhat small, they were much
less realistic than I may have hoped. Maybe things have changed a little since
then: the committee is at least [talking about
safety](https://cor3ntin.github.io/posts/kona22/#the-future-of-c-safety), and
[CppCon22's closing keynote](https://www.youtube.com/watch?v=ELeZAKCN4tY)
included a strong desire for memory safety in C++.

My next stop was to consider what _the lessons of Rust_ may be that we could take
back to C++. Could C++ have a borrow checker? Another colleague,
[@adetaylor](https://github.com/adetaylor/), had considered
[a runtime borrow checker](https://github.com/adetaylor/cpp-borrow-checker) briefly.
Runtime-only safety checks push the feedback cycle on bugs really far from the
development process, sometimes right out into the stable channel. This makes sense for
defense in depth, but it does not resonate for me as a strategy for developers to rely
on. I explored if we could do
[borrow checking in the C++ type system](https://docs.google.com/document/d/1SdVT-4lvBUYp8LSq-cHClQGbipU7UP-rS3O-IB5fJZg/edit),
through something like smart pointers. Ultimately, no.

Another key lesson from Rust is found in its integer types. Clean APIs for
handling trapping, wrapping, and saturated arithmetic. No conversions you
didn't ask for, especially conversions that involve gaining or losing a sign
bit, or truncating your value. Trying to fix integer unsafety in C++ while
working with primitive C++ types has presented itself
[as nearly impossible](https://docs.google.com/presentation/d/10Y6pOluQoqZt-9MC95vPAQs6bJPn-Kdqfh_aE6TzQtM/edit?resourcekey=0-kthnnGJMikFc7f3-iPFbjA#slide=id.g1c5cc391dd_2_295). Chromium
has [safe integer types](https://source.chromium.org/chromium/chromium/src/+/main:base/numerics/;drc=cb4e529012c9dd5e3f5abbfa471f27728d978cc8) and casts, which was a great
innovation by [@jschuh](https://github.com/jschuh). Rusts integer types take
this idea and make it extremely ergonomic. A colleague in Chrome Security,
(@palmer)[github.com/noncombatant], was exploring the idea of a standard-library-like
project, which we called libboring after Boring Pointers. This encoded the idea to
provide safe arithmetic in a library for projects like Chromium to consume,
while giving some space to rethink the API. However it didn't gain a lot of traction
immediately, it would need a significant engineering investment, and there were other
things to explore still.

So I steered toward considering if Chromium could use Rust to move toward memory safety. It had
been rejected once before, but there was so much more to learn. The question that
needed answering was how to fit Rust into the Chromium project in a way that
would make sense to developers, be easy to use, and have a story for how use of
Rust would change over time, with incremental adoption. Rust would need to
replace C++ code as a primary language over time, all through the software
stack, if it was going to solve the memory safety problems in C++.

My team was successful in finding good answers to a number of problems:
- Deterministic [debug builds](https://github.com/rust-lang/compiler-team/issues/450).
- Writing tests in Rust that [integrate into our C++ Gtest
framwork](https://source.chromium.org/chromium/chromium/src/+/main:testing/rust_gtest_interop/README.md;drc=52eef31fd75d970c1470ab1131ad07cfa8f88cfb). Though it did require some trips through Rust
[compiler bugs with static initializers](https://github.com/rust-lang/rust/issues/47384), and
exploring but ultimately rejecting a proposed RFC for [custom test frameworks](https://github.com/rust-lang/rust/issues/50297#issuecomment-1043753671).
- Considering how to [integrate async Rust into Chromium's async Callback system](https://chromium-review.googlesource.com/c/chromium/src/+/3405501).

But the Rust train hit a bit of a brick wall when we started looking carefully at unsafe Rust
and aliasing rules. I had the fear of unsafe Rust instilled in me through my work on a
side-project with [@quisquous](https://github.com/quisquous/cactbot) by developing a
[Rust wrapper around a C API](https://docs.rs/craydate/latest/craydate/) for
[Playdate](https://play.date/). It was far easier to introduce UB than I had imagined, and
more imporantly, far harder to find all the places that did so. Miri was no help for a
project with language interop.

But worse (for Chromium) than introducing UB through unsafe Rust, we noticed that
it's trivial for C/C++ to introduce UB in Rust:
- Pass or return pointers that get held as Rust references and which alias illegally.
- Mutate anything that Rust has a reference to. This is especially easy since const is [not transitive in C++](https://godbolt.org/z/883Kofq8h) the way [it is in Rust](https://play.rust-lang.org/?version=stable&mode=debug&edition=2021&gist=ec427383bf9eeae948291618e8756a93).
- All the familiar C++ use-after-free problems which it could leak into Rust.

This presented a new mental model for me that C++ is all unsafe Rust, which I am
[starting to see elsewhere](https://cor3ntin.github.io/posts/safety/#a-cakewalk-and-eating-it-too),
and which I found unsettling. No one would ever write 17M lines of unsafe Rust (the amount
of C++ in Chromium), all interacting with each other freely in complex ways, and expect anything
good to happen. This had an outsized impact on the shape of the nascent
[adoption of Rust in Chromium](https://groups.google.com/a/chromium.org/g/chromium-dev/c/0z-6VJ9ZpVU/m/BvIrbwnTAQAJ)that was announced a month ago.

The [Crubit project](https://github.com/google/crubit) is heroically attempting
to find ways to eliminate or contain the ways for C++ to introduce UB in Rust. I
contribute to this projcet and I hope that it can succeed. But it's also an
experiment, and it's not yet clear if the result will be ergonomic or simple
enough to justify working with it as a primary development language.

If you're writing something new, Rust is in my opinion the obvious choice over C++ in
most scenarios. After the on-ramp, you will be more productive, especially when it comes
time to refactor your code to add some new feature.

But we urgently need something to address the huge amount of existing C++ in Chromium,
and elsewhere.

> And so we must contend with the gloomy reality that is backward compatibility.
> Or rather, existing code.
> 
> Of all the C++ code written these past 40 years, a fair amount probably still runs.
> And the Vasa is no ship of Theseus. It would be, to my dismay, naive to imagine that
> all of that production code qualifies as modern C++. We should be so lucky to find
> reasonable C++ in consequential proportions. So, we should not expect guidelines
> about lifetimes and ownership to be followed.
>
> -- <cite>cor3ntin: https://cor3ntin.github.io/posts/safety/#a-cakewalk-and-eating-it-too</cite>

# Starting principles

From this whole journey through C++ to Rust and back, I have acquired a few beliefs from
which to work. And I see many of these same things being echoed around in recent days.

## Rust did things right

A key belief that I have landed on, and have yet to be disuaded of, is that Rust
did things right. They had the benefit of hindsight over 40 years of devlopment
with C++, not to mention all the language research over that time. This led to
the starting from the right principles, putting safety first and working from
there.

The Rust standard library is well-designed, and provides a cohesive story of how
to use the language and its features. This is in stark comparison to the C++ standard
library which regularly gains new features (e.g.
[std::optional](https://en.cppreference.com/w/cpp/utility/optional),
[concepts](https://en.cppreference.com/w/cpp/language/constraints))
but then fails to use those in its own design, presumably due to the committee's
commitment to backward compatibility with a library designed for C++98.

## Work outside the establishment

If we're going to find memory safety in C++, we need to look for ways outside the
committee, and outside the compiler and standard library.

This has been further reinforced as the proliferation of "C++ successor languages" has
rolled out this year from current and former WG21 members, including
[Carbon](https://github.com/carbon-language/carbon-lang),
[Val](https://www.val-lang.dev/), and [Cpp2](https://github.com/hsutter/cppfront).

> I find it a bit terrifying how the committee is sometimes willing to push
> things by 3 years, with little thought about how users would be impacted.
> If you look at concepts, coroutines, pattern matching, modules, and other
> medium-sized work, you are looking at a decade on average to standardize a
> watered down minimal viable proposal. However you look at it, shoving “safety”
> in the language sounds more complex than all of these things.
>
> The idea is simple: instead of foaming at the mouth and shouting about memory
> safety, we should look at all checkable UB and precondition violations and assert
> on them... None of that requires changes to the core C++ language though. They are
> practical solutions that we could have deployed years ago. Luckily, most of these
> things don’t even need to involve the C++ committee.
> 
> <cite>-- cor3ntin: https://cor3ntin.github.io/posts/safety/#but-we-care-about-safety-right</cite>

## Make things better, but not worse too

Whatever solutions we consider can't make things worse some of the time, even if it
makes things better other times. This means not introducing new ways to have UB.
C++ has enough already.

In particular, this is what makes Rust as a strategy to replace all C++ development
in an existing project a particularly risky endevour. However, an endevour that
[Crubit](https://github.com/google/crubit) may enable in the future.

## Incremental application is required

Any proposal for C++ memory safety must be able to be applied in an incremental
manner across an arbitrarily complicated and interconnected codebase. It should not
disturb existing code, but must still provide some tangible guarantees and benefits.

> 100% source compat, pay only when you use it.
>
> <cite>-- Herb Sutter on cpp2: https://www.youtube.com/watch?v=ELeZAKCN4tY</cite>


## New code is worth addressing
- I like to think that most vulnerabilities in C++ have already been written. New code is more likely to abide by modern practices and use language and library facilities that make it easier to write correct code. Maybe. I am trying to be optimistic. Safety by good practices and convention certainly is no guarantee of anything but it does help, to a point.




But the really big and really obvious takeaway here is: The easiest way to interop
with existing C++ code is to stay in C++. Of course, then you have all the C++
memory safety problems, unless you're working in a _different_ C++.








https://www.swift.org/blog/swift-5-exclusivity/

https://www.youtube.com/watch?v=ELeZAKCN4tY
- Can C++ be 10x Simpler & Safer? - Herb Sutter - CppCon 2022
- 100% source compat, pay only when you use it.
- 5 of MITRE's 2022 Most Dangerous Software Weaknesses:
  - Out-of-bounds read/write
  - Use-after-free
  - Null pointer deref
  - Integer overflow
- Claim that integer overflow is bounds safety cuz it only matters if it's used for pointer arithmetic, but ignores signed overflow is UB.
- Graph of memory safety CVEs: Root cause by patch year
  - Lifetime safety is ~50%
  - Bounds safety is ~40%
    - Must contain integer bugs by the previous claim, so unclear what % is bounds and what % is integers.
  - Initialization safety is ~5%
  - Type safety is ~3%
- cpp2 improves the latter by banning a bunch of things.
- cpp2 improves init safety with runtime checks.
- cpp2 improves bounds safety by inserting bounds checks on containers, which are already available in libc++.
- cpp2 totally punts on lifetime safety, addressing only null pointers, and only by preventing writing null into a pointer, no type safety with null.
- "I have not said the word monad once. All of the words and ideas that we have been using are not weird foreign terms from some other language, not some weird foreign concepts from some other language. They are things we are deeply familiar with. They're how we talk. They're how we think. I want that to stay that way, just nicer.

https://cor3ntin.github.io/posts/safety/
- I like to think that most vulnerabilities in C++ have already been written. New code is more likely to abide by modern practices and use language and library facilities that make it easier to write correct code. Maybe. I am trying to be optimistic. Safety by good practices and convention certainly is no guarantee of anything but it does help, to a point.
- We can imagine adding non-aliasing references to C++. I am not sure exactly how. But it would go swimmingly though, exactly as it went with rvalue references. We also would have to figure out destructive move. We failed to do that once, but why should that stop anyone? So armed with our imaginary tools, we can start to have a nice and cozy “island of safety”. Our new safe code can call other safe code.
  - Surrounded by an army of raw pointer zombies, every time we would call or be called by the “unsafe subset of C++” (which would be 99.999% of C++ at that point), we risk the walls around our little safe haven to be toppled over.
- So even if we could add a borrow checker to C++, would there be even a point? C++, is a “continent of unsafety”; by having a safe C++-ish language in C++, that dialect would look a bit foreign to most C++ devs, and it would integrate poorly, by design. We would need a clear boundary. And the safe dialect would have different capabilities, could not reuse existing libraries (or even the standard library), and so forth.
- Sure, there are self-contained components that require more safety than others. For example, an authentication component, and a cryptography library.
  - We could use our safe dialect to write these.
  - And, because we are doing that to decrease the risk of vulnerabilities, we would reduce the surface area of the boundary between that new safe, green field component and the rest of the code as much as possible.
  - We end up with a piece of code that does not look like the rest of our C++ nor integrate with it. At this point, could we have not written that piece of code in… Rust?
  - The rules of interaction between a hypothetical safe C++ and C++ would be no different than that of C++ and Rust through a foreign function interface.
- And then maybe that question about the affordability of safety reduces to “Do we buy more hardware or do we rewrite it in Rust?”. I hope we give the people who can’t rewrite it in Rust options. Soon. Rewrites ain’t cheap.
- We also need better tools to prevent UB from happening. In its arsenal, Rust offers saturating arithmetic, checked arithmetics (returning Optional), and wrapping arithmetics. I hope some of that comes to C++26. If you expect overflow to happen, deal with it before it does, not after.
- Neither C++ nor Rust will ever be safe. They don’t need to be. They just need to be safe enough that vulnerabilities are rare, easier to find, and harder to exploit.
- Rust understands the value of taking the resources to ensure the correctness of running programs. Correctness by default. Safety first. Even without a borrow checker, GCC’s Rust implementation is less sharp of a tool than C++.

