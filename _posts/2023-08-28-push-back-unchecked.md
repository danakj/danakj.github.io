---
tags:
- C++
- Subspace
- Undefined Behaviour
description: Encapsulating Undefined Behaviour in the C++ Standard Library for Performance with Safety
---
# On push_back_unchecked: Performance with FromIterator and Collect

A very nice blog post went by today titled
"[The Little Things: The Missing Performance in std::vector](https://codingnest.com/the-little-things-the-missing-performance-in-std-vector/)".

You should read it, but in case you don't, the premise is that [`std::vector::push_back`](
https://en.cppreference.com/w/cpp/container/vector/push_back) is wasteful when you're appending
a bunch of things to a vector, since you can reserve space for them all but it keeps checking if it
needs to allocate more space on every loop iteration. The author calls for a
`std::vector::push_back_unchecked` method that appends under the assumption that space is already
allocated. This exposes Undefined Behaviour if you do it wrong, of course, and the author argues
that this is both necessary and good. And I agree.

This blog, and my efforts in the C++ language space, are all around reducing the negative impact of
Undefined Behaviour and eliminating memory-safety bugs. So the above may seem counter-intuitive at
first glance.

I recently argued that the nature of the C++ standard library is basically [to expose Undefined
Behaviour](https://sunny.garden/@blinkygal/110871585437820584):
>  This is the nature of bare C++; it is as close to the hardware as possible for historical and
> good reasons. The C++ standard intentionally leaves no room for a lower level language (except
> hardware assembly), and it exposes all the complexity of the compiler through the std lib
> (e.g. type_traits). This is an "assembly language for systems programming".

And in that same vein, adding `std::vector::push_back_unchecked` would expose the nature of the
conceptual C++ machine, and allow authors to control that machine more effectively.

**<div style="text-align: left; font-size: 110%">Undefined Behaviour is Good.</div>**

Chandler Carruth argues for Undefined Behaviour from a slightly different perspective in his CppCon
2016 talk, [Garbage In, Garbage Out: Arguing about Undefined Behavior With Nasal Demons](
https://www.youtube.com/watch?v=yG1OZ69H_-o). Undefined Behaviour gives us performance, as we can
see clearly from the `push_back_unchecked` proposal.

But that sentence above is not complete without a qualification which usually gets missed in the
C++ world. Completed, it reads:

**<div style="text-align: left; font-size: 110%">Undefined Behaviour is Good when it is Encapsulated.</div>**

I believe `std::vector` should expose that Undefined Behaviour along with, and because it exposes,
many
other Undefined Behaviours. **However that also implies that `std::vector` is not suitable for use in
most application code**. It is a building block on which performant APIs can be built which
encapsulate the inherent unsafety of its own API that leaks Undefined Behaviour all throughout.

## FromIterator and Collect

Subspace provides the
[`FromIterator`](https://danakj.github.io/subspace-docs/sus-iter-FromIterator.html) concept
and then implements this concept for `sus::Vec` and `std::vector` as well as all the types in the
[standard containers library](https://en.cppreference.com/w/cpp/container).

Like most of the Subspace library, this is a reimplementation of the Rust [`FromIterator`](
https://doc.rust-lang.org/std/iter/trait.FromIterator.html) trait. If not already familiar with the
trait and its many uses, the key points for us here are:
- You can construct a container from another container, or an iterator.
- The construction happens in a single atomic step, from the perspective of application logic,
    which is typically the iterator [`collect`](
    https://danakj.github.io/subspace-docs/sus-iter-IteratorBase.html#method.collect) method.
    - See also the Rust
     [`collect`](https://doc.rust-lang.org/std/iter/trait.Iterator.html#method.collect)
     for more code examples that will look similar in C++ but aren't in the Subspace docs (yet).

By providing the ability to construct a container like a vector in an atomic operation from an
arbitrary set of inputs, we provide the ability for the library to give a safe and simple API
abstraction around a powerful operation which can be implemented entirely on top of APIs that
expose Undefined Behaviour. Because of the atomic nature, the use of those unsafe APIs is fully
encapsulated from the application layer, allowing the use of them in a controlled manner. Much
like in how "safe Rust" applications are built on top of a stdlib full of unsafe Rust,
yet retain memory safety for themselves,
this creates the opportunity to build a safer security-critical C++ application without sacrificing
performance. In fact, **as we'll see, we can gain performance**.

## Performace Optimizing FromIterator and Collect

The benchmarks provided in the aforementioned "Missing Performance in std::vector" article showed
on Clang 15:
- A 5x improvement when building a small to medium vector from a simple integer mapping.
- A 1.3x improvement when building a large vector of the same.
- A nearly 3x improvement when building a small to medium vector from a simple mapping function
  that unwraps a struct.
- A 1.1x improvement when building a large vector of the same.

I was curious how `FromIterator` would compare with `sus::Vec`. 
If `push_back_unchecked` existed, the implemetation of `FromIterator` for `std::vector`
could absolutely make use of
the method, with no risk of introducing Undefined Behaviour and memory safety bugs into the
application as a result. For `sus::Vec` we have full access to the underlying data structure so we
can do all the unsafe things internally that we want, and we should be able to see the same impact
as with `push_back_unchecked`. Given that, how does `FromIterator` compare to
the naive `v.reserve(..); for (..) { v.push_back(..) }` approach?

I copied the benchmarks from the above article and added them to the Subspace
[nanobench](https://github.com/martinus/nanobench) test suite.

At first, it was slow. Really slow. `Vec` does not define that it is empty after a move, instead
the moved-from Vec is left invalid and `Vec` checks for use-after-move. Additionally, `Vec` tracks
outstanding iterators and terminates if mutated instead of invalidating the iterator and proceeding
with Undefined Behaviour. But the inner loop of `FromIterator` was checking these things over and
over again. So I added some internal methods to break apart checks and implementation, and to split
up methods for better inlining. Then I used local variables to avoid indirections through
`this`-pointers.

The PR containing the changes and the benchmarks is https://github.com/chromium/subspace/pull/337.

Here's [the results](https://github.com/chromium/subspace/pull/337#issuecomment-1696793264) of
building `sus::Vec` via `FromIterator` compared to building a `std::vector`,
on my M1 Mac with Clang 18:
- A nearly 4.5x improvement when building a small to medium vector from a simple integer mapping.
- A 1.7x improvement when building a large vector of the same.
- A 1.5-2x improvement when building a small to medium vector from a simple mapping function
  that unwraps a struct.
- A 1.03x improvement when building a large vector of the same.

Comparing `FromIterator` on `std::vector` is done to verify the iterator appoach isn't changing the
nature of the operation, and indeed we see that putting the `push_back` loop into the `collect()`
operation has no visible impact. But the structure enables something more.

| benchmark   | n          | std::vector         | std::vector + FromIterator | sus::Vec + FromIterator | std::vector / sus::Vec |
| ---------   | ---------- | -----------         | -------------------------- | ----------------------- | ---------------------- |
| copy + mult | 1,000      | 426.00 +- 0.85 ns   | 452.67 +- 2.7 ns           | 98.45 +- 0.1 ns         | 432.7%                  |
| copy + mult | 100,000    | 39.144 +- 0.04 us   | 37.95 +- 0.04 us           | 8.75 +- 0.41 us         | 447.4%                  |
| copy + mult | 10,000,000 | 6.14 ms +- 0.04 ms  | 6.33 +- 0.03 ms            | 3.67 +- 0.03 ms         | 167.3%                  |
| to_index    | 1,000      | 351.07 +- 0.35 ns   | 350.30 +- 0.35 ns          | 176.97 +- 1.24 ns       | 198.4%                  |
| to_index    | 100,000    | 31.20 +- 0.031 us   | 31.20 +- 0.031 us          | 20.56 +- 0.88 us        | 151.8%                  |
| to_index    | 10,000,000 | 7.83 +- 0.031 ms    | 8.19 +- 0.057 ms           | 7.65 +- 0.038 ms        | 102.4%                  |

The last column shows the relative speedup of the `sus::Vec` + `FromIterator` approach is compared
to `std::vector`.

**We have a similar speed improvement to what we saw by using `push_back_unchecked`, and without any
Undefined Behaviour exposed to application developers**.
