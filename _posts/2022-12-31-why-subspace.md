---
tags:
- Subspace
- Memory safety
- C++
- CIR
- Chromium
---

## Why Subspace

To close out this year, I want to talk about why I am doing the
[Subspace](https://github.chromium/subspace)
experiment and where I see it going. The ultimate goal is memory safety in C++, which has
become quite the hot topic in the last few months.

This post ended up referring quite a lot to cor3ntin's fantastic
[recent post on C++ safety](https://cor3ntin.github.io/posts/safety/#a-cakewalk-and-eating-it-too).
I agree with a lot of it, and disagree with some of it, and I recommend reading
that first if you haven't!

This is a long post, so here's a table of contents if you'd like to jump around.
To understand Subspace where is going, I believe it's helpful to also understand how it
began, and what else was tried first. So let's start there.

(Disclaimer: This post is full of opinions, 100% of which are mine and do not represent
my employer, my colleagues or possibly anyone else.)

* TOC
{:toc}

### The land before space-time

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
- Chrome Security was enumerating Undefined Behaviour in C++ and documenting what
was being done so far. It told the story of a thousand plugs trying to stop a ship from
sinking. But there was no coherent overarching story behind it all, and many issues
had no clear way to resolve them. This
[continues today](https://github.com/llvm/llvm-project/issues/59525) on a one-by-one
basis.

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
development process, sometimes right out into the shipped release. This makes sense for
defense in depth, but it does not resonate for me as a strategy for developers to rely
on. I explored if we could do
[borrow checking in the C++ type system](https://docs.google.com/document/u/1/d/e/2PACX-1vSt2VB1zQAJ6JDMaIA9PlmEgBxz2K5Tx6w2JqJNeYCy0gU4aoubdTxlENSKNSrQ2TXqPWcuwtXe6PlO/pub),
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
[@noncombatant](https://github.com/noncombatant), was exploring the idea of a standard-library-like
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
framework](https://source.chromium.org/chromium/chromium/src/+/main:testing/rust_gtest_interop/README.md;drc=52eef31fd75d970c1470ab1131ad07cfa8f88cfb). Though it did require some trips through Rust
[compiler bugs with static initializers](https://github.com/rust-lang/rust/issues/47384), and
exploring but ultimately rejecting a proposed RFC for [custom test frameworks](https://github.com/rust-lang/rust/issues/50297#issuecomment-1043753671).
- Considering how to [integrate async Rust into Chromium's async Callback system](https://chromium-review.googlesource.com/c/chromium/src/+/3405501).

But the Rust train hit a bit of a brick wall when we started looking carefully at unsafe Rust
and aliasing rules. I had the fear of unsafe Rust instilled in me through my work on a
side-project with [@quisquous](https://github.com/quisquous/cactbot), developing a
[Rust wrapper around a C API](https://docs.rs/craydate/latest/craydate/) for
[Playdate](https://play.date/). It was far easier to introduce UB than I had imagined, and
more importantly, far harder to find all the places that did so. Miri was no help for a
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
[adoption of Rust in Chromium](https://groups.google.com/a/chromium.org/g/chromium-dev/c/0z-6VJ9ZpVU/m/BvIrbwnTAQAJ)
that was announced a month ago.

The [Crubit project](https://github.com/google/crubit) is heroically attempting
to find ways to eliminate or contain the ways for C++ to introduce UB in Rust. I
contribute to this project and I hope that it can succeed. But it's also an
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

### Starting principles

From this whole journey through C++ to Rust and back, I have acquired a few beliefs from
which to work. And I see many of these same things being echoed around in recent days.

#### Rust did things right

A key belief that I have landed on, and have yet to be dissuaded of, is that Rust
did things right. They had the benefit of hindsight over 40 years of development
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

#### Work outside the establishment

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

#### Make things better, but not worse too

Whatever solutions we consider can't make things worse some of the time, even if it
makes things better other times. This means not introducing new ways to have UB.
C++ has enough already.

This is what makes Rust as a strategy to replace all C++ development in an existing
project feel like a particularly risky endeavour. However, an endeavour that
[Crubit](https://github.com/google/crubit) may enable in the future.

#### Incremental application is required

Any proposal for C++ memory safety must be able to be applied in an incremental
manner across an arbitrarily complicated and interconnected codebase. This means
it can be used for new code in an existing codebase, without disturbing existing code,
but must still provide some tangible guarantees and benefits. And it must be able
to be applied to existing code in an incremental way.

> 100% source compat, pay only when you use it.
>
> <cite>-- Herb Sutter on cpp2: https://www.youtube.com/watch?v=ELeZAKCN4tY</cite>

#### Leaving safety should be obvious

The default paths should be safe; developers should have to opt into unsafety
whenever possible. And doing so should be through a consistent and clear syntax
mechanism that can be seen clearly in code review, and can be watched for by
tooling. The `unsafe` keyword is the best example of this, but without the
ability to add keywords to the language, there must be another way.

> - Pragma ``unsafe_buffer_usage`` allow[s] you to annotate sections of code as
>   opt-out of... the programming model...
> - Attribute ``[[unsafe_buffer_usage]]`` lets you annotate custom functions as
>   unsafe...
>
> <cite>-- https://reviews.llvm.org/differential/changeset/?ref=3751471</cite>

> Rust is not about having no dragons, it’s about containing them. `unsafe` also
> raises red flags in code reviews, which is exactly what we want.
>
> -- cor3ntin: https://cor3ntin.github.io/posts/safety/#borrowing-the-borrow-checker

#### Global knowledge is harmful

The Rust static analysis that produces memory safety is able to do so through
local analysis of a single function at a time. This is the only approach that
scales and can fit in developers heads. Any by requiring functions to depend
only on local knowledge, this also benefits developers. Humans are more likely
to make mistakes if they have to understand state or requirements far from the
code they are changing. New developers to a codebase will have know that such
things even exist to look out for.

#### New code is worth addressing

Changing how new code is written is meaningful. While most C++ code can be generally
assumed to have memory safety bugs waiting to be found, new C++ code continues to be
the largest observable source memory safety bugs in Chromium.

> I like to think that most vulnerabilities in C++ have already been written. New
> code is more likely to abide by modern practices and use language and library
> facilities that make it easier to write correct code. Maybe. I am trying to be
> optimistic. Safety by good practices and convention certainly is no guarantee of
> anything but it does help, to a point.
>
> <cite>-- cor3ntin: https://cor3ntin.github.io/posts/safety/#a-cakewalk-and-eating-it-too</cite>

The reason memory bugs in new C++ code dominate is probably because fuzzers and researchers
have already spent a lot of time on the existing code, making it unlikely for them to turn
up new things there, even though they exist. But nonetheless this means relying on the current
facilities of modern C++ to prevent memory safety bugs is not working as a strategy. We
continue to write memory safety bugs as a software engineering industry at an incredible pace.

#### Interop with C++

The really big and really obvious takeaway here is: The easiest way to interop
with existing C++ code is to stay in C++. Of course, then you have all the C++
memory safety problems, unless you're working in a _different_ C++.

One vision of a different C++ implies changes to the language itself, which leads to
certain outcomes.

> We can imagine adding non-aliasing references to C++. I am not sure exactly how. But
> it would go swimmingly though, exactly as it went with rvalue references. We also
> would have to figure out destructive move. We failed to do that once, but why should
> that stop anyone? So armed with our imaginary tools, we can start to have a nice and
> cozy “island of safety”. Our new safe code can call other safe code.
>
> Surrounded by an army of raw pointer zombies, every time we would call or be called
> by the “unsafe subset of C++” (which would be 99.999% of C++ at that point), we risk
> the walls around our little safe haven to be toppled over.
>
> ...
>
> So even if we could add a borrow checker to C++, would there be even a point? C++,
> is a “continent of unsafety”; by having a safe C++-ish language in C++, that dialect
> would look a bit foreign to most C++ devs, and it would integrate poorly, by design.
>
> Sure, there are self-contained components that require more safety than others. For
> example, an authentication component, and a cryptography library.
>
> We could use our safe dialect to write these.
>
> ...
>
> We end up with a piece of code that does not look like the rest of our C++ nor
> integrate with it. At this point, could we have not written that piece of code in…
> Rust?
>
> The rules of interaction between a hypothetical safe C++ and C++ would be no
> different than that of C++ and Rust through a foreign function interface.
>
> _“Rewrite it in a slightly different yet completely incompatible C++!”_ sure is a
> rallying cry!
>
> <cite>-- cor3ntin: https://cor3ntin.github.io/posts/safety/#borrowing-the-borrow-checker</cite>

If the "safe C++" is so different from normal C++, is a different language, you end up going
through FFI anyways. But this is where [Work outside the establishment](#work-outside-the-establishment)
comes in.

If we are constrained to working in C++ as it exists today, then the "safe C++" must integrate
with existing C++. There must of course be some difference in how the safe C++ is constructed,
or you have done nothing at all, but the impact of this difference on C++ beyond its borders is
necessarily limited. Bugs or mistakes in the existing C++, the "army of raw pointer zombies"
surrounding your "safe" code, may still introduce bugs in your code. But it can't make things
worse than they were before, there's no _new_ UB to be found by doing the wrong thing across the
boundary. And other "safe" code would not be able to introduce memory bugs in your code. That
would be something new to C++.

### How to change C++

To primary way to change C++ without changing the language or the compiler is to write a
library. The standard library exposes UB to the developer through many of its public APIs,
and the committee will not remove those APIs.

The approach being taken in [libc++ safe mode](https://libcxx.llvm.org/UsingLibcxx.html#enabling-the-safe-libc-mode)
is to introduce asserts, and crash when UB would have occurred.

> The idea is simple: instead of foaming at the mouth and shouting about memory safety, we
> should look at all checkable UB and precondition violations and assert on them. This is
> what I hoped for contract, the other C++ feature is highly related to the S-word and
> going nowhere.
>
> -- cor3ntin: https://cor3ntin.github.io/posts/safety/#correct-by-confusion

This provides defense in depth, it protects users against existing code, and is a good idea.
But to be a safety strategy for C++ developers, we need to shift left. Instead of crashing on
UB, I would like a future world where C++ developers have a different choice. A development
environment which does not present a footgun at every turn. Define the UB out of existence.

> We also need better tools to prevent UB from happening. In its arsenal, Rust offers saturating
> arithmetic, checked arithmetics (returning Optional), and wrapping arithmetics. I hope some of
> that comes to C++26. If you expect overflow to happen, deal with it before it does, not after.
>
> None of that requires changes to the core C++ language though. They are practical solutions
> that we could have deployed years ago. Luckily, most of these things don’t even need to involve
> the C++ committee.
>
> -- cor3ntin: https://cor3ntin.github.io/posts/safety/#correct-by-confusion

Safe C++ code should not crash, it should be safe by construction. It should prevent the bugs
from existing, not just try to prevent the bugs from being a backdoor onto your device. But
that means safe C++ code can not depend on the standard library.

This presents a chicken-and-egg type of problem. Without safe C++, there's no means to write
a new standard library to satisfy the safe C++. Without a standard library there's no way to
have safe C++.

But the Rust community has done some seriously heavy lifting in this space. They have given
us a language and an ecosystem of memory safe code, proving it is possible at scale, in
production.

> Rust understands the value of taking the resources to ensure the correctness of running
> programs. Correctness by default. Safety first. Even without a borrow checker, GCC’s Rust
> implementation is less sharp of a tool than C++.
>
> They have a strong mental model for strong safety. They don’t throw exceptions in the
> presence of logic errors, with the naive hope that someone will handle that somehow,
> somewhere, and that the program should do something, anything to keep running.
>
> And they do care about performance, undoubtedly. In many cases, Rust is as fast or faster
> than C++. And in very rare cases, the developer does know better than the compiler and there
> are escape hatches to unhook the safety harness, even if that comes with a lot of safety
> stickers in the documentation.
>
> -- cor3ntin: https://cor3ntin.github.io/posts/safety/#first-born-unicorn-dream-of-carcinization

The Rust standard library has no UB if you don't drop down to `unsafe`. If we could expose a similar
demarcation in a C++ library, then users would not be exposed to UB unless they asked for it, and
their reviewers would be able to see where it was happening too. And the Rust standard library
goes further than just eliminating UB.

The Rust standard library presents a coherent system that builds on its own primitives
([safe integers](https://doc.rust-lang.org/stable/std/primitive.i32.html),
[Option](https://doc.rust-lang.org/stable/std/option/enum.Option.html),
[Result](https://doc.rust-lang.org/stable/std/result/enum.Result.html), etc).

We've seen Option and Result come to the C++ standard library, as
[optional](https://en.cppreference.com/w/cpp/utility/optional)
and [expected](https://en.cppreference.com/w/cpp/utility/expected),
but they both arrived with
[UB exposed](https://www.open-std.org/jtc1/sc22/wg21/docs/papers/2021/p0323r10.html#deref)
through their C++ APIs, even
[just for consistency](https://www.open-std.org/jtc1/sc22/wg21/docs/papers/2021/p0323r10.html#moved-from)
with pre-existing UB, and they are not used to make the C++ standard library easier to use correctly.
Should safer integer types arrive in C++26 or 29 or 33, they will not appear in the APIs of the C++
standard library either.

Rust takes the position that defaults matter, and this is expressed throughout its standard
library. Defaults like no null pointers. The best-in-class way to write a non-null pointer in
C++ is somehow still a reference. But the C++ standard library does not treat references
as such, and continues to introduce types that
[do not support the use of references](https://www.open-std.org/jtc1/sc22/wg21/docs/papers/2021/p0323r10.html#expected-references) in them.

Vobaculary types in Rust are composable and powerful with safe, rich APIs. For example the
interactions between [Option](https://doc.rust-lang.org/stable/std/option/enum.Option.html#method.ok_or)
and [Result](https://doc.rust-lang.org/stable/std/result/enum.Result.html#method.ok), or
[Result and Iterators](https://doc.rust-lang.org/stable/std/iter/trait.Iterator.html#method.collect).

The APIs of the Rust standard library can be used in a world without mutable aliasing, a key component
of locally enforced memory safety.

And being the excited library implementer that I am, I noted that the Rust standard library
does some [very nice things](https://doc.rust-lang.org/std/option/index.html#representation)
with type layout.

### Starting Subspace

Subspace began from asking what it would look like to port the Rust standard library into
C++20, for all the reasons elaborated above.

I began with [PRINCIPLES.md](https://github.com/chromium/subspace/blob/1593f7fbe36b029571c7d4b10459d7c30d04b432/PRINCIPLES.md)
where I wrote my aspirations for the library. Much like Herb Sutter
[with cpp2](https://www.youtube.com/watch?v=ELeZAKCN4tY),
I desire to remove complexity from the language. And that hope is encoded in the
principles charter. Performance matters too, but slightly more important than just
performance is _predictable_ performance. For example, the
[small-string optimization](https://stackoverflow.com/questions/21694302/what-are-the-mechanics-of-short-string-optimization-in-libc)
makes `std::string` faster in many cases, but it introduces a huge performance cliff that
is not visible to the user.

Then I moved on to implementation; the proof is in the pudding, as they say.

I started with integers, and Subspace now has integer and float types that provide the same
safety guarantees (and APIs) as their Rust counterparts.

```cpp
auto i = 2_i32;  // An i32 type.
auto j = 2_u32;  // A u32 type.

// Protects against sign conversion.
i += j;  // Doesn't compile, it would require a sign conversion.
i += sus::into(j);  // Converts `j` at runtime into an i32, terminating if the value won't fit.

// Protects against overflow.
j -= 10_u32;  // Terminates due to underflow.
j = j.wrapping_sub(10_u32);  // Wraps around by explicitly asking for it.
sus::Option<u32> r = j.checked_sub(10_u32);  // Tells you if it underflowed by returning Option.
```

Oh, and that is all constexpr.

When I got to `checked_sub()` I needed an `Option` type, so I moved on to that. Subspace now
has `Option<T>` which supports:
- Holding a reference type, as `Option<T&>`. No nullable pointer required.
- The [null pointer optimization](https://doc.rust-lang.org/stable/std/option/index.html#representation)
  in a more general form, as the
  [`sus::NeverValueField` concept](https://github.com/chromium/subspace/blob/1593f7fbe36b029571c7d4b10459d7c30d04b432/subspace/mem/never_value.h#L137-L144).
- Safe defaults. Terminates if `unwrap()` is called when there's nothing inside. If moved-from, the
  Option contains nothing, instead of containing an object in a moved-from state.
- Can be used in a `switch` statement, and should C++ gain `inspect` it will work there too.
- Methods to transform the contained value in a safe way, producing a new `Option` with the
  transformed value.

```cpp
sus::Option<i32> o = sus::some(2_i32);
sus::Option<i32> n = sus::none();

// Protects against UB.
sus::move(n).unwrap();  // Terminates since there's no value inside.
pass_along(sus::move(o));
o.unwrap();  // Terminates as the value was moved away.

// The null pointer optimization means no extra boolean flag.
static_assert(sizeof(sus::Option<i32&>) == sizeof(i32*));

// The NeverValueField optimization means no extra boolean flag for
// other types as well.
static_assert(sizeof(sus::Option<sus::Vec<i32>>) == sizeof(sus::Vec<i32>));
```

Oh, and this is all constexpr too. However due to limitations of unions and
standard layout types in a constexpr context, reading the current state from
an Option is not constexpr. This could point toward a future change in the C++
standard that would have a clear benefit. I will write a future blog post
about the NeverValueField optimization and the limitations here.

The Option type plays along with Result in all the same ways as in Rust, and
they each
[play along with Iterators](https://github.com/chromium/subspace/blob/1593f7fbe36b029571c7d4b10459d7c30d04b432/subspace/option/option_unittest.cc#L1963-L1992)
in the same way too.

```cpp
auto v = Vec<Option<i32>>();
v.push(sus::some(1));
v.push(sus::some(2));

Option<CollectSum> o = sus::move(v).into_iter().collect<Option<CollectSum>>();
// If `v` contained an empty option, `o` will be an empty option.
// Otherwise, `v` contains CollectSum, which is a `FromIterator` type and
// has itself collected all the values in the vector.

// The same works with collecting `Result`s, where you get back a `Result` with
// the collected answer, or the first error found.
auto v = Vec<Result<i32, ErrCode>>();
Result<CollectSum, ErrCode> r = sus::move(v).into_iter().collect<Result<CollectSum, ErrCode>>();
```

If only C++ could infer the type parameter for `collect()`. Maybe a future C++ standard
could address this.

But yes, Subspace has Iterators too. Not pairs of pointers like the C++
standard library. Composable Iterator objects which present a single object, and thus
a single lifetime, to the compiler. And they work with C++ ranged for loops. Using them
compiles twice as fast as C++20 ranges, and doesn't consume exponential
stack space: [subspace](https://godbolt.org/z/o4W7xccMq)
vs [ranges](https://godbolt.org/z/dMqzEaqxj).

```cpp
auto v = sus::Vec<i32>();
v.push(1);
v.push(3);
v.push(5);

auto count = v.iter().filter([](const i32& i) { return i >= 3; }).count();
// `count` will be `2_usize`.

auto sum = 0_i32;
for (const i32& i: v) {
  sum += i;
}
// `sum` will be `9_i32` (from 1 + 3 + 5).
```

The use of `sus::move()` above doesn't stand out, but even it provides safer
defaults to `std::move()` by rejecting a const input. With `std::move()`
you just get a copy instead with no visible indication that it occurred. And along
with the principle of building on its own types, I've used `sus::move()` throughout
the library implementation, showing it was not a problem for template code.

And there's `unsafe`, but we can't add keywords. So instead there's `unsafe_fn`,
a marker type passed to functions or methods that may introduce UB if you hold
them wrong. This gives the means to go below the safe API where you need to,
in super narrowly scoped ways, and without having to write
[whole new data structures](https://bugs.chromium.org/p/chromium/issues/detail?id=1358853#c14)
to avoid libc++ hardening.

```cpp
auto v = sus::Option<u32>();
sus::move(v).unwrap_unchecked(unsafe_fn);  // Oops, UB! But you asked for it.
```

The library introduces the concept of
[trivially relocatable](https://www.open-std.org/jtc1/sc22/wg21/docs/papers/2019/p1144r4.html)
in a type-safe way without changing the language.

Clang has provided a `[[clang:trivial_abi]]`
[attribute](https://clang.llvm.org/docs/AttributeReference.html#trivial-abi) for a few
years, which has recently been extended to apply to a new `__is_trivially_relocatable`
[builtin](https://clang.llvm.org/docs/LanguageExtensions.html). This allows libc++ to
perform trivial relocation for annotated types. However the attribute can not be used
on template classes where the template parameters would affect the trivial-relocatability
of the type, such as if any type parameters define a value inside the class.

The subspace library provides the concepts
[relocate_one_by_memcpy](https://github.com/chromium/subspace/blob/1593f7fbe36b029571c7d4b10459d7c30d04b432/subspace/mem/relocate.h#L115-L117)
and
[relocate_array_by_memcpy](https://github.com/chromium/subspace/blob/1593f7fbe36b029571c7d4b10459d7c30d04b432/subspace/mem/relocate.h#L111-L113)
which determine if a type is trivially relocatable. The determination is made based
on clang's `__is_trivially_relocatable` if possible. But it also allows a template
class to opt into being trivially relocatable based on its template parameters,
through
[sus_class_maybe_trivially_relocatable_types()](https://github.com/chromium/subspace/blob/1593f7fbe36b029571c7d4b10459d7c30d04b432/subspace/mem/relocate.h#L139-L185)
or similar hooks.

The result is that `sus::Option<i32>` is treated as trivially relocatable within the
subspace library, and can be done so by user code as well by checking `relocate_one_by_memcpy<T>`.
This is possible only because `sus::Option<NotRelocatableType>` can be differentiated and
will not be treated as trivially relocatable.

### Where does Subspace go next

There's a lot more to do in the library, but it's reached a point where
- The core pieces are there from which to build the rest, and they work.
- The most risky looking things have been able to be ported over, and I am no
longer worried that this part of the experiment will fail.

But new vocabulary types have a huge cost. Even if this library provides a means
to avoid all the sharp edges of the C++ standard library, it would represent a
large fracture in the C++ ecosystem. I believe it needs to provide _more value_
than just its APIs to be worth adopting it outside of specialized scenarios.

One of the most interesting things about porting the Rust standard library APIs
into C++ is that we know that those APIs, and use of those APIs, will pass a
borrow checker. And to bring safety to C++ needs more than APIs without UB, it
needs memory safety.

But we have already established that borrow checking is
[not feasible](https://docs.google.com/document/u/1/d/e/2PACX-1vSt2VB1zQAJ6JDMaIA9PlmEgBxz2K5Tx6w2JqJNeYCy0gU4aoubdTxlENSKNSrQ2TXqPWcuwtXe6PlO/pub)
from within the C++ type system. But I believe that it is feasible, even for
C++, inside a compiler.

But it means introducing more restrictions to C++ code
than just lifetimes on pointers and exclusive access through mutable pointers. In Rust,
const is transitive through references, and this is core to its ability to determine exclusive
mutability. So a C++ borrow checker will need to enforce new rules on `const` as well.

At this time, such a large lift would not be feasible in any production C++ compiler,
and it could actually be a poor choice as it would restrict the use of it to that single
compiler. So, like [cfront](https://en.wikipedia.org/wiki/Cfront) and
[cppfront](https://github.com/hsutter/cppfront), I believe it's time to write a compiler.
But instead of producing code, it need only produce a yes or a no-with-errors as its
outputs.

The Rust team built their first borrow checker on Rust's HIR, something akin to the
Clang AST. This ended up complicating their implementation and restricting the rules they
were able to enforce. In my contributions to Crubit's
[lifetime analysis](https://github.com/google/crubit/blob/0182c5c085e2c179c73695a996902a5f8b7ed537/docs/lifetimes_static_analysis.md)
I have also seen the difficulty of building on top of the AST. The
[full complexity of C++](https://www.youtube.com/watch?v=ZfP4VAK21zc#t=16s)
has to be dealt with all over your tool. Rust solved this problem by introducing
[MIR](https://blog.rust-lang.org/2016/04/19/MIR.html), a mid-level representation of the
language that reduces the full language down to a small set of instructions. This enabled
a new evolution in their borrow checker, and new compiler optimizations. For now, I am
mostly interested in the former.

A recent brainstormy conversation with my colleague [@veluca93](https://github.com/veluca93)
made me believe that a MIR for C++ is also possible. So my path to writing a borrow checker
is going to start with producing a MIR for C++, denoted CIR. Some quick iteration with
@veluca93 has produced
[a simple syntax](https://github.com/chromium/subspace/blob/1593f7fbe36b029571c7d4b10459d7c30d04b432/cir/syntax.md),
which is still in flux, but is something like this for constructing and destructing a class `S`.

```
fn f@0() -> void {
    let _1: S
    let _2: *S

    bb0: {
        _2 = &_1;
        call S::S(_2)
        call S::~S(_2)
        return
    }
}
```

It will need to grow to support some parts of the language, like async. But it's a
clear simplification over [the clang AST](https://clang.llvm.org/docs/IntroductionToTheClangAST.html)
and, as Rust has shown, along with [lifetime annotations](https://github.com/google/crubit/blob/0182c5c085e2c179c73695a996902a5f8b7ed537/docs/lifetime_annotations_cpp.md), it can have everything we need to write
a borrow checker.

### The future

This is a wild experiment, but if successful it would give us a world where we can write
C++ with memory safety, by running a borrow checker against it.

It won't fix existing code, but it won't break existing code either, and it doesn't
require complicated FFI with extra rules at the boundary between safe and unsafe C++. You
simply do or do not choose to borrow check your code.

And it will provide the basic building blocks in a standard library to write new safe
C++, and incrementally move existing C++ into a safe world.

### Other recent work

#### Cpp2

I see this work as being very complimentary to [Cpp2](https://www.youtube.com/watch?v=ELeZAKCN4tY),
introduced at CppCon22. Herb presented this graph of CVE root causes:

![CVE root causes by year](/resources/2022-12-31-why-subspace/cve_cause_by_year_2022-11-12.png)
- Lifetime safety is ~50% of CVEs.
- Bounds safety is ~40% of CVEs.
  - However, I believe Herb mixed in all integer overflow with bounds safety based on his claim
    that it only matters if it causes an out of bounds issue. Nonetheless, signed integer overflow
    is UB which produces security bugs with or without bounds overflow, so some part of this number
    should be counted separately as integer overflow in my opinion.
- Initialization safety is ~5% of CVEs.
- Type safety is ~3% of CVEs.

The Cpp2 syntax provides new answers for things that need a
_code-generating_ compiler: initialization safety and type safety.
These address ~8% of CVEs by the previous graph.

The syntax also addresses bounds safety in a way that needs a compiler intervention, by
banning pointer arithmetic. This is very similar to the C++ Buffer Hardening proposal for
clang, though without the opt-in/opt-out semantics other than dropping down to a standard C++
syntax function. It also introduced bounds checks on containers that crash, which is
basically the "c++ safe mode" without your standard library opting in, and without an API
choice to crash or return an Option. Together, these address some part of the bounds safety CVEs,
though it's not clear how much.

If successful, Subspace would address bounds safety on containers a richer way, but would also rely
on a compiler like `cpp2` or C++ Buffer Hardening to deal with pointer arithmetic.

Subspace will also address lifetime safety which is the root cause of the other ~50% of CVEs.

Not mentioned at all in the analysis presented at CppCon22 is Undefined Behaviour. Since
UB does lead to security vulnerabilities, these bugs must be getting grouped into other
categories, like type safety with unions, or being omitted. Nonetheless, Subspace will address
the wide access to UB that is present in the C++ standard library.

#### C++ Buffer Hardening

Clang recently began development on a "C++ Safe Buffers" proposal that would allow
for banning pointer arithmetic outside of clear opt-in scenarios, and allows for
incremental adoption of the restriction across an existing codebase.

The [user documentation](https://reviews.llvm.org/differential/changeset/?ref=3751471) is
still under review at this time, though implementation has already begun.

I gave a talk about this at a Chrome-hosted memory safety summit in November, from which
you can see the
[slides and speaker notes](/resources/2022-12-31-why-subspace/cpp_safe_buffers_2022-11-30.pdf).

This work, like Cpp2, is very complimentary to Subspace. Functions that perform unchecked
pointer arithmetic today would use the Subspace `unsafe_fn` marker type as a function parameter
to denote the jump to unsafety. The C++ Safe Buffers warning brings this into the compiler with a
`[[clang::unsafe_buffer_usage]]` annotation. The downside of this approach comes from current
limitations of C++:
- It is non-standard so it's only available in a single compiler.
- It requires using #pragmas to inform the compiler that a call-site can call an annotated
  function. In the future, I would love to see C++ adopt the ability to apply attributes to
  blocks of code other than functions in order to remove the requirement of #pragmas for
  static analysis.

#### Swift exclusivity

Swift recently announced that they will begin
[enforcing exclusive mutability](https://www.swift.org/blog/swift-5-exclusivity/)
in the language in order to guarantee their memory safety goals.

This is a terrific step and further demonstrates the importance of exclusive
mutability. It also gives further evidence, alongside Rust, that a production systems
programming language can require it, and can check for it at compile time. This does
look like the future of systems development.

4bae52616d8070a7c137d53861002ad822787e8a