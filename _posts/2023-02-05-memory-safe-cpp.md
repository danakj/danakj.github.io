---
tags:
- C++
- Memory safety
---

## Memory Safe C++

The advice keeps being repeated. Something to the tune of: If you're writing a new piece of
software, and you care about security and need to handle attacker-controlled data, don't write it
in C++. Write it in Rust.

Or, perhaps, if you care about productivity and don't want to waste days at a time debugging strange
behaviours that are not explained by your source code, work in Rust. Two sides of the same coin
of memory bugs that C++ is in the hotseat for right now.

I'm not here to tell you otherwise, I could not honestly do so. But we have a big C++ problem to
worry about. There's a _lot_ of C++ software in the world right now. Decades of it.

You are almost certainly reading this right now in an application written in C++, on an operating
system written in C++. If I were a bad actor, and I wanted to target you for surveilance, it's very
probable that I would have already
[exploited that C++ application and operating system and installed spyware on your device](
https://www.technologyreview.com/2021/05/06/1024621/china-apple-spy-uyghur-hacker-tianfu/).
Or maybe I didn't succeed this time, and I would just
[catch you the next time](https://blog.exodusintel.com/2019/04/03/a-window-of-opportunity/)
you
[didn't update your software fast enough](https://www.cybersecurity-help.cz/blog/3012.html).
Attackers get to keep trying until they get what they wanted.

This is a serious problem and it needs answers. So what do we do with the C++ code?

First, find ways to start replacing code with Rust. Android
[has shown the effectiveness](https://security.googleblog.com/2022/12/memory-safe-languages-in-android-13.html)
of this approach.

This works well for pieces of code with clear domains and purpose. Things like
[parsers](https://serde.rs/) and
[codecs](https://github.com/pdeljanov/Symphonia/blob/master/README.md) and
[gpu implementations](https://github.com/gfx-rs/wgpu).
But the [real challenge comes](https://security.googleblog.com/2023/01/supporting-use-of-rust-in-chromium.html)
in the application code that is all tangled up together in complex ways.

David Teller gives [a strong framework](https://yoric.github.io/post/safety-and-security/) for us to
understand why it's harder in a nest of mutable pointers that shows up C++ application logic. I
very much recommend reading if you want to understand what it means to write a "safe" or "secure"
application, or for a programming language to be ascribed the traits of "safe" or "secure".

In particular, he presents this (IMO) intuitive way to understand memory safety:

> Memory safety (within a set of types and invariants) A piece of code is memory safe if it is
> both write safe and read safe with respect to these invariants.
> -- <cite>David Teller: https://yoric.github.io/post/safety-and-security/</cite>

So a language is memory safe if it keeps you from writing or reading data unsafely. And then write
safety is defined as:

> Write safety (within a set of invariants): A piece of code is said to “break write safety” if, at
> any point, it overwrites a value, breaking an invariant of the code. It is write-safe if it never
> breaks write safety.
> -- <cite>David Teller: https://yoric.github.io/post/safety-and-security/</cite>

And unsurprisingly, read safety is defined as:

> Read safety (within a set of types and invariants): A piece of code is said to “break read safety”
> if, at any point, accessing memory as a given type T results in a value that does not respect the
> invariants of T. It is read-safe if it never breaks read safety.
> -- <cite>David Teller: https://yoric.github.io/post/safety-and-security/</cite>

And he makes the point that "breaking invariants/safety does *not* mean introducing a
vulnerability. It most likely means introducing a bug. It also means that you don’t know what your
code is [doing], so this bug might introduce a vulnerability."

And I will add that while not all memory safety bugs (or breaking of read or write safety) lead to
security vulnerabilities, many do. The only way to stop having those vulnerabilities is to stop
having those bugs.

What I like about this framework is that it gives us a nice way to talk about exclusive
mutability, among other things like staying-in-bounds. Exclusive mutability is a property guaranteed
by the Rust language: that only one reference to a piece of memory can write to it (or move it)
at a time, and you can not interleave reads and writes to the same memory through different
references. This categorically removes chances to break write and read safety.

## How does C++ makes this hard?

The C++ language, and the way C++ software is written as a result, make enforcing exlcusive
mutability very difficult. Let's look at some ways that it does so.

### Aliasing Pointers

C++ not only fully supports and encourages the use of aliasing references to memory,
the language is _built on them_.
Iterators are typcially nothing more than a pointer to the internals of the
container, and they always come in _pairs_. Every time you iterate through a container, you
have at least three accessible aliasing references: the container itself, which is freely accessed
while iterating, and the iterators themsleves.

It's trivial in C++ to interleave reads and writes to the same memory through different references,
which leads to [breaking write and read safety](https://godbolt.org/z/x3dnb9ha9).

```cpp
std::vector<int> v; // References the memory in `v`.
v.reserve(1u);
v.push_back(1);

auto iter = v.begin();  // References the memory in `v`.

// May rellocate the memory in `v`. Breaks write safety since `iter` expects its
// reference to remain valid.
//
// This violates exclusive mutability, as we're mutating the memory in `v` while there
// exists another reference to it.
v.push_back(2); 

// Breaks read safety, as modifying the vector means the iterator is not valid.
//
// We may have expected this to return `1` but it can instead read from deallocated memory. A
// Use-after-Free, which can show up in a CVE.
return *iter;
```

Breaking read/write safety like this is possible and does happen even in local code like the above,
but preventing it at scale in a large application gets near impossible.

Here's another trivialized example, but now we expose a reference to some memory through the
public API of a class.

```cpp
class ProgramObject {
 public:
  const std::vector<int>& values() const { return values_; }
  void AddValue(int i) { values_.push_back(i); }
 private:
  std::vector<int> values_;
};

void OnEventHappened(ProgramObject& po, const Event& e) {
    // Is this safe to do?
    po.AddValue(value_for_po(e));
}
```

Is this code safe? It's not. While it _may_ be used safely, it's also possible to break write
safety in `OnEventHappened()`. Would the fault of such a break be 5 levels up the call stack
where a function call is made that ultimately ends up in `OnEventHappened()`? Or somewhere in
between? Or would it be another 5 levels up where some code is using the vector from `values()`,
perhaps iterating it, or simply not expecting its length to change in the middle of its use.
There's no good answer, because in C++ all of the code is responsible for coordinating perfectly.

Preventing a mistake like this in C++ is _hard_. No, really, impossible at any sort of scale.
That is because C++ gives us no way to express at the ProgramObject API that no one should call
`AddValue()` while _any other code in the system_ is using `values()`. We can add a comment, but
that's wishful thinking that it's even possible for humans to enforce such a thing in non-trivial
code. And it only gets harder with every refactoring, adjustment for a feature, or bug fix across
the project.

When modifying any function in C++ it's up to _every_ developer in the project to know all possible
invariants that must be upheld from all other code in the system that is accessible 
(through any variable), transitively. This includes all code accessible through
all stack frames of previously called functions, for all possible paths into your function.

We all try our best but this is basically impossible to get right all the time, which is why we
keep writing bugs that lead to CVEs. And the difficulty of doing so scales with:
- The number of pointers held and accessible in your system, especially as long-lived class fields.
- The "distance" of these pointers.

What do I mean by distance? Say 10 components all hold pointers to objects in one other
shared component. Those 10 components were all written and act completely independently; they are
conceptually far from each other. 
Yet the developers of each one must be intimately aware of what all of the other components do, and
any changes made to them over time, in order to avoid violating read or write safety.

#### How can a language provide tools to write safe code with our ProgramObject?

Rust disallows multiple references to an object when one is mutable. Calling `AddValue()` requires a
mutable reference to the `ProgramObject`. Such a mutable reference would not be able to be
exist while any other reference to `ProgramObject` or its members exists. This means it is not
possible for `values()` to be in use when `AddValue()` is called.

```cpp
void OnEventHappened(ProgramObject& po, const Event& e) {
    // This would be safe with exclusive mutability. The existance of `po` is
    // a proof provided by the compiler that no other reference exists to the
    // same `ProgramObject` or its `values()`.
    po.AddValue(value_for_po(e));
}
```

Val eliminates non-owning references to memory entire. Instead it requires all access to occur
through the equivalent of a lambda passed to methods on the object. This eliminates the chance
for code to hold state like iterators to `values()` across a distant call to `AddValue()`, since
that state would only be held inside the execution of
`ProgramObject::values(L lambda_acting_on_values)`.

### Everything is Copies

While no C++ code is written this way today, could we restrict C++ to prevent aliasing references?
If we could, would there be any point to rewrite C++ into that, instead of just writing it as Rust?
Maybe.. for interop with other C++, but what would that look like?

To avoid aliasing pointers, we require a lot more `std::move()` (or `sus::move()` if you want to
avoid silently copying const objects that you've tried to move).
This is because copying an object with a pointer accessible inside it will instantly create
aliasing references to the same memory. C++ makes it super easy to copy objects,
since moves were added in C++11 and only introduced as an accessory on top of the default path of
copying.

```cpp
int a = 2;
int b = a;  // A copy in C++.
f(b);  // Another copy in C++.
```

Whereas a language that can support exclusive mutability should present a different default
behaviour. In Rust, with the exception of rare explicitly-`Copy` objects, assigning from an
object or passing it to a function will move it.

```rs
let a = 2i32;
let b = a;  // A move in Rust.
f(b);  // Another move in Rust.
```

We can make C++ "move" the object by casting it to an rvalue reference with `std::move()`, but
it's somewhat an illusion.

```cpp
struct S { Unlucky* p; }

void f(S a) {
    S b = std::move(a);  // Still copying `p`.
    assert(a.p == b.p);  // Aliasing pointers.
}
```

We have, however, at least declared that we're changing the conceptual state of `a` to be
moved-from.

I wrote about [trivial relocations](https://danakj.github.io/2023/01/15/trivially-relocatable.html)
which is how a language like Rust always moves an object. This is powerful, as it means there is
only one conceptual instance of an object before and after a move; the memory is simply relocated.
While we can reproduce the same in a C++ library in limited ways, we can't change the way the core
language works with moves. And in the example above while `a` is "moved-from" the language still
allows access to it.

#### Clang-tidy to the rescue?

Clang-tidy has a warning that disallows use-after-move. In this simple example, it would cry
foul at using `a.p` after moving from it to construct `b`, even if the C++ language allows it.
However it has its limitations too.

```cpp
class BreakingThings {
 public:
  S TakeS() { return std::move(s_); }
  void UseS() {s_.p->oh_no(); }
 private:
  S s_;
};

void f(BreakingThings& b) {
    S s = b.TakeS();  // Creates an aliasing pointer.
    b.UseS();  // Uses an aliasing pointer with `s.p`.
    s.p->oh_no();  // Interleaved read/write through independent references.
}
```

Since `std::move()` is nothing but a cast, we can't actually rely on its use to prevent
use-after-move.

```cpp
void f(S&& s) {}  // Doesn't actually move from `s`.

S s;
f(std::move(s));  // Doesn't move here, nor in `f()`.
s.p->no_problem();  // So this is not a use-after-move.
```

In the example above, the `s` argument has `std::move()` wrapped around it and it is passed as an
rvalue reference, yet no move took place.
The function `f()` receives only a reference to `S`, which it may or may not move from. This
makes looking for use-after-move into a non-local analysis, where callees must be inspected to know
if a caller performing a use-after-move.

#### Restricting the language

To make finding all use-after-move tractable, we need to restrict the language and reject code that
does not conform to a more limited set of behaviours.

1. Moving from a data member is only allowed in a &&-qualified method. This would mean that either:
   -  `TakeS()` in the above example would need to become `TakeS() &&`, or
   - The `S s_` field would need to become `sus::Option<S> s_` and `TakeS()` would
     `return s_.take();`.
2. A function receiving an rvalue reference _must_ move from the reference on all possible
   code paths. This allows the analysis at the caller to remain local.

The first makes moves from an object transitive, so that they are visible locally at any call site.
The second makes moves into a function/object visible at the call site.

But this isn't yet enough, due to the lack of trivial relocations. We still have aliasing
references used in the example below. Since moves are really copies in C++, we have a destructor
in the moved-from object that still has access to the now-aliased pointer. And non-trivial
destructors are not uncommon.

```cpp
struct S {
    Unlucky* p;

    ~S() { p->oh_no(); }
};

void f(S s) {}

S s;
f(std::move(s));
```

So we need to restrict the language further:

3. All classes with pointers inside them (transitively) must:
   1. Provide a non-default move constructor and assignment operator that eliminates the moved-from
      pointers, preferably by storing them in a `sus::Option` to avoid null-deref UB.
   2. Ensure that all &&-qualified methods eliminate the moved-from pointers.
   3. Check for being moved-from in the destructor and avoid using any pointers.

However enforcing this would require observing the coordination between different methods of a
class, and is not realistic to enforce without additional constraints. For example, if we forced all
members of a class to encode moved-from, such as by forcing all (non-primitive?) members to be
`sus::Option`, then we could verify that the move constructor and assignment operator, and any
rvalue methods did set all the fields to `sus::None` along each codepath.

Even if accepting the extra runtime and cognitive complexity, this would not be a pleasant language
to work in.

Rust avoids this problem by making all moves trivial, but also by making it invalid to partially
destroy an object. That is, you can not move a field out of a struct at all. You would store the
field as a `std::Option` to avoid any possible use-after-move.

There is yet another way that moves can be hidden from local analysis, that is moving from an lvalue
reference. The caller to the function below would not know that the object they passed to `f()` was
moved-from, and would freely use-after-move afterward without any protection from the language.

```cpp
struct S { Unlucky* p; };

S f(S& s) { return std::move(s); }

S a;
S b = f(a);  // `a` is now moved-from, but the caller can't tell.
// Either `a.p` was made null and we create UB by using it, or `a.p`
// and `b.p` are now aliasing references to the same object.
a.p->oh_no();
```

Thus, another restriction to ensure all moves of local objects are locally visible is needed.

4. It is invalid to move from an lvalue reference.

Each of these rules restricts the language from what would otherwise be valid C++ code, with the
goal of making it locally possible to observe moving from local objects.

#### Breaking the language

However, these rules makes it impossible to implement core behaviour of the C++ language. For
example, a tuple could no longer be moved into structured bindings.

```cpp
auto [s1, s2] = std::tuple<S, S>(S(), S());
```

The structured bindings are implemented by calling `std::get<I>()` for the index `I` of each
element in the tuple. The call to `std::get<I>()` needs to:
- Move the element out of the tuple.
- But not mark the tuple itself as moved-from, so that the next element can be accessed too.

To do so, the call must receive an rvalue reference to the tuple, as in
`std::get<I>(std::tuple<S, S>&&)`, to be allowed to move each element out of the tuple. But our
rules above then require the tuple to be considered moved-from, and accessing `std::get<1>()`
after `std::get<0>()` would be considered a use-after-move. In fact it's certainly possible that
it _is_ a use after move with a different type, it just happens to be correct for `std::tuple`.
 
With control over the structured bindings call, which would require a change to the core language,
the call could instead pass the tuple as an lvalue reference. This would avoid the tuple being
considered moved-from before reading from the second element. However then the elements inside the
tuple can't be moved from, so the tuple would need to hold each element in a `sus::Option` or
equivalent, which would grow each element in the Tuple by at least a bool, and up to doubling each
element's size. But this is out of scope for a library or static analysis as it would require
changing the function call made by structured bindings, which is [dictated by the spec](
https://en.cppreference.com/w/cpp/language/structured_binding#Case_2:_binding_a_tuple-like_type).

As such, the language is in conflict with local analysis of use-after-move, and requires types to
be used after being accessed as an rvalue reference for core language behaviour.

### Aliasing everywhere

Preventing aliasing with a mutable reference to an object in C++ gets beyond the scope of what a
library or a static analysis (like a compiler that restricts the language) can accomplish without
breaking core language functionality.

To get there would require:
- Real moves, via trivial relocations, so that moves do not leave behind a copy.
- Built-in primitive tuple types and destructuring that avoids intermediate
  object states during destructuring. The tuple should be consumed by its destructuring into
  structured bindings.

As long as there are references that alias with a mutable reference to an object, read and write
safety can be broken, and the language is not safe in this regard. Memory safety bugs will happen,
and whole program understanding is required to always make correct changes to code that
interacts with any reference that _may_ alias.

### Const is a lie.




NEXT UP:
- transitive consttttt ahahaha.