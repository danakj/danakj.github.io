---
tags:
- C++
- Subspace
- Undefined Behaviour
description: Storing references in containers like Option
---
# Complexity of reference containers

While we can mourn the [lack of holding references in std::optional](https://thephd.dev/to-bind-and-loose-a-reference-optional), I want yall to know that holding references in a C++ type (or, appearing to anyway because it's got to be stored as a pointer) is incredibly tricky and subtle.

Subspace can represent references in [`Option<T&>`](https://suslib.cc/sus-namespace.option.html), [`Result<T&, E>`](https://suslib.cc/sus-result-Result.html), [`Choice<...>`](https://suslib.cc/sus-choice_type-Choice.html), and [`Tuple<T&, U&, ...>`](https://suslib.cc/sus-tuple_type-Tuple.html).

I think this is a _very_ powerful and useful thing, especially as `Option<T&>` is represented internally as _just a pointer_, no extra bool. This makes programming mistakes into very clear and actionable errors instead of UB and failures that require debugging and backtracking to even know what state was wrong.

But I think this set of vocab types is it, the value/cost drops off quickly, so I don't think I will want to support references in any other types.

What cost? Implementing support in a template for `T` being a value or a reference adds a lot of complexity to the implementation - which to be fair would be intractable before C++20 in my opinion. It adds a ton of testing complexity to make sure you're actually handling the references correctly and that you're never testing a concept against a reference which then answers for the pointee type, or acting on a reference in a way that reaches through to the pointee.

But also, receiving and storing a reference can lead to implicit and completely hidden memory safety bugs.

## Memory safety bugs

Let's take for example an `Option<const int64_t&>`. You can construct this `Option` by giving it a reference to an `int64_t` lvalue, or to an rvalue.

This is already a problem but one that is visible in the code at least. If you pass an rvalue to something that captures it as a reference, it will dangle. With `[[clang::lifetimebound]]` annotations, you get a warning/error too. Which I put every effort into making exhaustive, though it's a challenge since it's not possible to test for errors like these inside the language.

There's a worse situation though. A `const T&` will also apply implicit conversions!

So if you construct an `Option<int64_t&>` but pass it an `int32_t`, C++ will helpfully construct a temporary `int64_t` and use the reference to that.

Now you have Undefined Behaviour from a dangling reference, but one you didn't even write!

I wrote a concept that catches this scenario so that any methods that receive and hold a reference can reject this in a clear way. And it can be rejected in every compiler, not just through `[[clang::lifetimebound]]`. But this is yet another thing to test for and think about while building the APIs.

The concept is [`SafelyConstructibleFromReference`](https://suslib.cc/sus-construct-SafelyConstructibleFromReference.html).

I wrote down all the rules I had in my head today about building reference types in a markdown doc so that I can come back to them and can use them in code reviews in the future.

[https://github.com/chromium/subspace/blob/main/STYLE.md#containers-that-hold-references](https://github.com/chromium/subspace/blob/main/STYLE.md#containers-that-hold-references)

## Seeing it in Compiler Explorer

Here's a little example of these cases: [https://godbolt.org/z/q6q7GWaEY](https://godbolt.org/z/q6q7GWaEY)

You can see Clang can make a warning for each of the UB cases, but the other two compilers don't at all.

With the `SafelyConstructibleFromReference` concept, the last case which is very sneaky UB will be rejected on all compilers, though not the others.

If you remove some of the abstractions inside the `Option` there, GCC ends up seeing one of the three UB cases, but as we can see it's easy for it to lose that.