---
tags:
- Subspace
- C++
---

## Trivially Relocatable Types in C++/Subspace

* TOC
{:toc}

I read a [blog post](https://quuxplusone.github.io/blog/2023/01/13/embed-and-initializer-lists/)
about `#embed` and initializer lists today, and was pleasantly surprised to find a reference to
[P1144R6 Object relocation in terms of move plus destroy](
https://www.open-std.org/jtc1/sc22/wg21/docs/papers/2022/p1144r6.html) which I was previously
unaware of. The [Subspace library](https://github.com/chromium/subspace) makes use of
trivially relocating objects when possible, and it's nice to see work continuing toward bringing
this idea into the core language.

Relocatable objects is a key property of Rust types and allows for efficient code generation. When
an object is relocatable, it means that the combination of "move to destination" and
"destroy source" can be combined into a single `memcpy()`. And LLVM loves to optimize
`memcpy()`s, so this leads to some really good code generation.

In Rust, _all_ moves are relocations. And any use of an lvalue that is not `Copy` will move
(relocate) the object.

```rs
#[derive(Copy, Clone)]
struct Copy(i32);

struct NoCopy(i32);

fn main() {
    let c = Copy(0);
    let n = NoCopy(0);

    let _c2 = c;  // Copies `c` via memcpy().    
    let _n2 = n;  // Moves `n` to `n2` via memcpy().
    
    // `n` is no longer accessible, and will not be dropped, aka its
    // "destructor" will be skipped in C++ terms.
    // let _n3 = n;  // Does not compile.
}
```

C++ makes the story of moving and relocation more tricky in a few ways:

1. When an object `A` is moved from (ie. another object `B` accesses the object `A` as an rvalue
reference), the `A` object can enter any possible state as defined by `B`. The only hard requirement
is that it's valid to run `A`'s destructor, and its `operator=()` if it has one. This makes it very
difficult to understand what moving any object does. As it's all defined by the receiver, it can
even mean different things with the same types but in different places.
1. Because of the above, a moved-from object still has to be destroyed, so if it was an lvalue, C++
has to keep it around and you can keep referring to it, possibly erroniously, after it was moved
from. This makes relocating impossible in the general case without significantly changing the
well-established concepts of rvalue references and destructors.
1. Using an lvalue generates an "lvalue reference" to it. When needed, C++ will automatically copy
from an lvalue reference for types that support copying. But C++ is unable to promote an "lvalue
reference" into an "rvalue reference" which is how the language expresses something that can be
moved from. Thus constructing or assigning from an lvalue that can't be copied will simply fail to
compile instead of moving from the lvalue.

```cpp
struct Copy {
    Copy() = default;
    Copy(const Copy&) = default;
};
struct NoCopy {
    NoCopy() = default;
    NoCopy(NoCopy&&) = default;
};

int main() {
    Copy c;
    NoCopy n;

    Copy c2 = c;  // Automatically copies from the implied `Copy&` reference.
    NoCopy n2 = n;  // Can not copy from `NoCopy&` and will not choose to move it.
}
```

We can see the implied `NoCopy&` in the error produced by GCC, which tries to call `NoCopy(x)` where
`x` is a `NoCopy&`. The overload resolution promotes the `NoCopy&` to a `const NoCopy&` in order to
match the copy constructor. There's no similar promotion from `NoCopy&` to `NoCopy&&` which would
match the move constructor, so overload resolution fails to find something callable.
```
<source>:15:17: error: use of deleted function 'constexpr NoCopy::NoCopy(const NoCopy&)'
   15 |     NoCopy n2 = n;  // Can not copy from `NoCopy&` and will not choose to move it.
      |                 ^
```

Note that a type that is trivially copyable, or more precisely
[trivially-movable and trivially-destructible](
https://github.com/chromium/subspace/blob/082a4b5ff09860d818f6f9cf10603b3056849c13/subspace/mem/relocate.h#L72-L74),
then it is already trivially relocatable. That handles things like primitives and structs of
primitives, but we'd like to handle more cases.

### Trivially Relocatable for Libraries

While we can't expect that `a = b` could do a relocation in C++, as the author of a library like
(Subspace)[https://github.com/chromium/subspace], we can still perform relocation instead of
move + destroy inside our library types.

### Clang and libc++

libc++ does similar things. Clang provides the `[[clang::trivial_abi]]` attribute for marking a
type as trivial for the purposes of calls. This allows the destructor of a temporary object to be
moved into a function callee, allowing its contents to be passed by value instead of by reference
and avoiding the associated dereferences inside the callee.

[@Quuxplusone](https://github.com/Quuxplusone) proposed [the builtin
`__is_trivially_relocatable(T)`](https://reviews.llvm.org/D50119) to Clang in 2018, which was in
review for 2 years 🤯, and not accepted. He wrote a [blog post about it](
https://quuxplusone.github.io/blog/2018/07/18/announcing-trivially-relocatable/) also.

Then in 2021, [@ssbr](https://github.com/ssbr) [re-proposed the `__is_trivially_relocatable(T)`
builtin](https://reviews.llvm.org/D114732), by making it refer to types that are annotated by the
Clang attribute `[[clang::trivial_abi]]`. This meant that `__is_trivially_relocatable(T)` would be
true for that type. Since `std::unique_ptr` is [marked `[[clang::trivial_abi]]`](
https://github.com/llvm/llvm-project/blob/c68926d7e68aa56b452ae806709fb16b7c204e68/libcxx/include/__memory/unique_ptr.h#L307),
this also makes it considered as trivially-relocatable. This more narrow implementation of
`__is_trivially_relocatable(T)` was ultimately merged in early 2022.

Extending the definition of `[[clang::trivial_abi]]` in this way should allow the libc++ library to
then perform relocations instead of move + destroy for annotated types. However the
[implementation of this in std::vector](https://reviews.llvm.org/D119385) by
[@ssbr](https://github.com/ssbr) has not yet received the necessary support to land, about a year
later now, for reasons that are not clear to me.

### Subspace

In subspace we have a public library-only implementation of a concept similar to the proposed
[`__libcpp_is_trivially_relocatable`](https://reviews.llvm.org/D119385) for libc++. We call that
concept [`sus::mem::relocate_by_memcpy<T>`](
https://github.com/chromium/subspace/blob/082a4b5ff09860d818f6f9cf10603b3056849c13/subspace/mem/relocate.h#L86-L87)
at this time, though names are subject to change until explicitly stabilized.

The implementation of the concept looks like the following:

```cpp
template <class... T>
concept relocate_by_memcpy = __private::relocate_by_memcpy_helper<T...>::value;
```

With its inner helper implementation:

```cpp
template <class... T>
struct relocate_by_memcpy_helper final
    : public std::integral_constant<
        bool,
        (... &&
         (!std::is_volatile_v<std::remove_all_extents_t<T>>
          && sus::mem::data_size_of<std::remove_all_extents_t<T>>()
          && (relocatable_tag<std::remove_all_extents_t<T>>::value(0)
              || (std::is_trivially_move_constructible_v<std::remove_all_extents_t<T>> &&
                  std::is_trivially_move_assignable_v<std::remove_all_extents_t<T>> &&
                  std::is_trivially_destructible_v<std::remove_all_extents_t<T>>)
#if __has_extension(trivially_relocatable)
              || __is_trivially_relocatable(std::remove_all_extents_t<T>)
#endif
             )
         )
        )
      > {};
```

The inner helper trait uses `std::remove_all_extents_t<T>` everywhere instead of just `T` and that
is so that we produce the same answer for `T` and `T[]` and `T[][]`, etc. Conceptually we can ignore
it here, and we will strip it out in the snippets below.

Let's walk though what the inner helper trait is doing from the bottom to the top.

First, we ask the compiler if the type is trivially relocatable, if it can tell us. This refers
to types annotated as `[[clang::trivial_abi]]` in the Clang compiler thanks to the work of
[@ssbr](https://github.com/ssbr) mentioned above. So `T` is `relocate_by_memcpy` if:

```cpp
__is_trivially_relocatable(T)
```

Second, as we noted above any type that is trivially-movable and trivially-destructible
can be relocated by memcpy() operation instead of the move + destroy operation. This is why `T`
is `relocate_by_memcpy` if:

```cpp
(std::is_trivially_move_constructible_v<T> &&
 std::is_trivially_move_assignable_v<T> &&
 std::is_trivially_destructible_v<T>)
```

We require move-constructing and move-assigning to both be trivial as trivially relocatable must
mean the type can be trivially relocated under both scenarios. This is also brought up in [P1144R6](
https://www.open-std.org/jtc1/sc22/wg21/docs/papers/2022/p1144r6.html#pmr-concerns) since
`std::pmr::vector` is not trivially relocatable under move-assignment.

Next we start to get into our library definitions of relocatability with `relocatable_tag<T>`. The
tag this is looking for is generated by a tool that the Subspace library provides for marking a type
as trivially relocatable. We'll get back to how that works later. For now it's enough to say that
our type `T` has opted into being trivially relocatable in a manner that depends only on standard
C++ and thus works across all compilers. So `T` is `relocate_by_memcpy` if

```cpp
relocatable_tag<T>::value(0)
```

Any single one of the above conditions tells Subspace that `T` may be trivially relocatable. But
regardless of which was true, the type `T` must also have a non-zero "data size", which is checked
by `sus::mem::data_size_of<T>()`.

#### Data size

The "data size" of a type is an idea introduced by [@ssbr](https://github.com/ssbr) and described
[in the documentation](
https://github.com/chromium/subspace/blob/082a4b5ff09860d818f6f9cf10603b3056849c13/subspace/mem/size_of.h#L47-L93)
for `sus::mem::data_size_of<T>()`. The same concept was then used in his [Rust RFC](
https://internals.rust-lang.org/t/pre-rfc-allow-array-stride-size/17933) meant to describe this same
concept to Rust in order to allow Rust to relocate C++ objects soundly.

We'll try to describe it here simply. C++ has a concept of the size of an object, which is returned
by `sizeof()`. The size of an object may include padding, and of particular interest here is the
tail padding.

```cpp
struct S {
    int32_t a;  // 4 bytes.
    int8_t b;   // 1 byte.
                // 3 bytes of tail padding.
};
```

For the above type, `sizeof(S)` is `8`. Why is there tail padding making the size 8
instead of 5? The answer is alignment and arrays. In particular, incrementing a pointer by the size
of a type must produce another pointer that is properly aligned for that type. Another way to put
it is that the position of each object in an array is at a multiple of its size, so the size must
produce a well-aligned value.

In this case the alignment of `S` is going to match the alignment of its most-restricted member,
which is the `int32_t`. The size and alignment of `int32_t` is 4, so the alignment of `S` is 4. So
its size is a multiple of 4, that is greater than or equal to 5, making its size 8 with 3 bytes of
tail padding.

```cpp
S arr[] = { S(1, 1), S(2, 2), S(3, 3) };

S* p = &arr[0];  // A well-aligned pointer.
p += 1; // Increments the pointer by the size of `S`. Must be well-aligned again.
```

Given that we understand the size of a type, the "data size" is the actual size of the data
inside the type _excluding tail padding_. So the data size of `S` above would be `5`, which is
the number of bytes occupied by its members `int32_t a` and `int8_t b`.

When the "data size" of a type differs from its "size", it becomes a [potentially overlapping type](
https://quuxplusone.github.io/blog/2018/07/13/trivially-copyable-corner-cases/).

#### Why do we care about data size?

It's very common to write code that will `memcpy()` a type based on its size. Something like:

```cpp
S s;
S s2;
memcpy(&s2, &s, sizeof(S));
```

This works great! Until it doesn't! There's one way this could go wrong in older versions of C++,
and a new way for this to go wrong in C++20.

##### Base classes

The empty base class optimization allows a class type's size to be treated as 0 when it is inherited
from. Typically C++ does not have zero-sized types. Every object must have a unique address, which
means it must have a size of at least 1 byte.

```cpp
struct S {};
static_assert(sizeof(S) == 1);
```

But the language relaxes this specifically for a base class. Here the size of `T` is still 1, even
thought the size of `S` is also 1:

```cpp
struct S {};
struct T : public S {};
static_assert(sizeof(T) == 1);
```

And to be clear that it's the _base_ class which has a zero size, here the size of `T` is 4, which
is the size of its member. There is no extra byte for its base class `S`:

```cpp
struct S {};
struct T : public S { int32_t a; };
static_assert(sizeof(T) == 4);
```

This presents the first case where the data size of an object matters. If we were to
`memcpy(&s, &from, sizeof(S))` into an `S*` but it so happens that the object is a `T`, we would
overwrite one byte of `T::a` with garbage! However if we
`memcpy(&s, &from, sus::mem::data_size_of<S>())`, then we copy nothing, which is the right thing.

The [Clang](https://godbolt.org/z/oejGWP694) and [GCC](https://godbolt.org/z/jjxcMYd3n) (but not
[MSVC 19](https://godbolt.org/z/7fczM93Gn)) compilers have taken this further, and will generally
make use of the tail padding in any base class that is not a [Standard-Layout](
https://en.cppreference.com/w/cpp/language/classes#Standard-layout_class) type.

Recall our earlier example of a struct with tail padding. We mark the `b` member as `private` in
order to make the type not [Standard-Layout](
https://en.cppreference.com/w/cpp/language/classes#Standard-layout_class).

```cpp
struct S {
    int32_t a;
  private:
    int8_t b;
    // 3 bytes of tail padding.
};
static_assert(sizeof(S) == 8);
```

When we make a subclass of `S`, the compiler is entitled to place members into the tail padding of
`S`.

```cpp
struct T : S {
    int8_t c;
    // 2 bytes of tail padding.
};
static_assert(sizeof(T) == 8);
```

The size of `T` is the same as `S` because the member `c` has been placed inside the tail padding of
the base class `S`. If we were to `memcpy(&s, &from, sizeof(S))` into an `S*` that has been
subclassed by `T`, we would overwrite one byte of `T::c` with garbage! However if we
`memcpy(&s, &from, sus::mem::data_size_of<S>())`, then we copy only 5 bytes (the `int32_t a`
and `int8_t b`) into `s` and avoid clobbering the members of `T` or any other subclass in its tail
padding.

##### The `[[no_unique_address]]` attribute

C++20 introduces the `[[no_unique_address]]` attribute which can appear on a class type's member
declaration. It tells the compiler to allow the member's tail padding to be used by the following
members.

This new attribute allows us to compose a new type with a member `S` that makes use of its tail
padding. Here we use the same non-Standard-Layout type `S` from the previous section. We add another
member below `S` but the size of `T` [is no larger](https://godbolt.org/z/GhbvTaecM) because the
member `T::c` has been located in the tail padding of `S`.

```cpp
struct T {
    [[no_unique_address]] S s;
    int8_t c;
    // 2 bytes of tail padding.
};
static_assert(sizeof(T) == 8);
```

The side effect of the `[[no_unique_address]]` attribute is that `memcpy()` can do the wrong thing
again. If we `memcpy(&s, &from, sizeof(S))` into an `S*` that points to the member `T::s` of `T`,
we will copy the tail padding of `from` into `T::c`, clobbering its value with garbage. Here again,
if we `memcpy(&s, &from, sus::mem::data_size_of<S>())` then we copy only 5 bytes (the `int32_t a`
and `int8_t b`) into `s` and avoid clobbering anything in its tail padding.

However, as in the [base class example](#base-classes), MSVC 19
[does not](https://godbolt.org/z/TxoP4h9jY) make use of the tail padding in `S`
and the size of `T` will be 12. This [also holds](https://godbolt.org/z/x6szhYPxo) when
using the compiler-specific [`[[msvc::no_unique_address]]` attribute](
https://devblogs.microsoft.com/cppblog/msvc-cpp20-and-the-std-cpp20-switch/) instead.

##### Sorry but memcpy() with sizeof(T) is dangerous

The outcome of the above is that `memcpy(dest, src, sizeof(T))` is dangerous in generic code, and
even more so in C++20. The more correct thing to do is
`memcpy(dest, src, sus::mem::data_size_of<T>())`.

#### The Limits of Data size in a Library

For some types, we can not determine a data size. In particular, a union's data size is dynamic
depending on its active member. If we could enumerate the members of a union, we could use the
maximum data size of all its members, but that is beyond the scope of what a library can achieve
unfortunately.

For that reason, the subspace implementation of data_size_of<T> on a union type [will return 0](
https://github.com/chromium/subspace/blob/21a55214fdd968ba01118697721b708b83540521/subspace/mem/__private/data_size_finder.h#L61-L65).
This means that a data size of 0 should be treated as unknown, and this explains why we require
a non-zero data size in `sus::mem::relocate_by_memcpy`.

#### Volatile and trivially relocatable

Popping the stack, we were walking through our implementation of `sus::mem::relocate_by_memcpy`.
The first condition checked is if the type is `volatile`. A `volatile` type can not be copied
byte-by-byte with `memcpy()` without [introducing the chance of tearing](
https://quuxplusone.github.io/blog/2018/07/13/trivially-copyable-corner-cases/). So these types
are strictly excluded. This also helps with defining trivial relocatable for classes with volatile
members as we will see.

### Opting into trivially relocatable

In Clang, a type may opt into being trivially relocatable with the class annotation
`[[clang::trivial_abi]]`. However there are two important things missing from this attribute:

1. The attribute only works on Clang. A standard library should work well across all compilers.
1. The attribute can't take template parameters into account.

While `[[clang::trivial_abi]]` works for `std::unique_ptr<T>`, it does so because the data member of
the class is `T*` and a pointer is always trivially relocatable. A simple example where we can not
use the attribute would be:

```cpp
template <class T>
struct S {
    T t;
};
```

Here the struct `S` is trivially relocatable if `T` is. But marking the type with
`[[clang::trivial_abi]]` would introduce Undefined Behaviour when `T` is not. And this is where the
proposal [P1144R6](https://www.open-std.org/jtc1/sc22/wg21/docs/papers/2022/p1144r6.html) does
something important by adding a boolean expression to the `[[trivially_relocatable]]` attribute.
This makes it possible to conditionally apply the attribute to different template instantiations of
a template type. The proposal also automatically infers trivially relocatable from its members, so
we need a more complex example to see when this matters.

```cpp
template <class T>
struct S : InheritMyMoveOperation<T>, InheritMyDestructor<T> {
};
```

Here neither the `InheritMyMoveOperator` nor `InheritMyDestructor` have enough information to
determine if the type `S` should be trivially relocatable. The member of type `T` can only be present
in one of the two, and that would dictate the behaviour for `S`. But the property must be determined
based on the interaction of the move operation and destructor. The same follows for helper
structures that may not define their own move operations or destructors, such as unions.

In this example `S` is trivially relocatable, since the destructor is a no-op after being moved
from. But we can't tell from its members.

```cpp
template <class T>
struct S {
    S() : t(T()) {}
    S(S&& o) : moved_from(o.moved_from) {
        if (!o.moved_from) {
            new(&t) T(sus::move(o.t));
            o.t.~T();
            o.moved_from = true;
        }
    }
    ~S() {
        // No-op if we were moved from.
        if (!moved_from)
            t.~T();
    }
    bool moved_from = false;
    union {
        T t;
    };
}
};
```

So we would like to opt into being trivially relocatable based on the knowledge of our
implementation:

```cpp
template <class T>
struct [[trivially_relocatable(sus::relocate_by_memcpy<T>)]] S {
    ...
};
```

The Subspace library has done a similar thing, but at the library level instead of in the compiler.
We provide 4 macros that can opt a class type into being trivially relocatable.

#### sus_class_assert_trivial_relocatable_types(unsafe_fn, types...)

By using the `sus_class_assert_trivial_relocatable_types()` macro in a
class definition, the class is marked unconditionally as trivially relocatable. This is similar
to the `[[clang::trivial_abi]]` attribute, and whenever it appears it would be ideal to also mark
the class `[[clang::trivial_abi]]`. By specifying both, the type will:
* Be trivial for the purpose of passing under Clang.
* Be opted into trivial relocation in the Subspace library across all compilers.

The macro must receive the `unsafe_fn` marker type as its first parameter to indicate
that this requires careful scrutiny. The author declares that move + destroy can be done through
memcpy() and it is up to them to get that correct. If the move constructor (or assignment) or the
destructor must run for correctness, this would introduce bugs and possibly Undefined Behaviour.

Since the macro requires that the types are trivially relocatable, it makes sense to use in
non-template classes. Typically the type of every non-static data member would be passed to the
macro.

```cpp
struct sus_if_clang([[clang::trivial_abi]]) S {
    Thing<int> thing;
    int i;
    sus_class_assert_trivial_relocatable_types(
        unsafe_fn,
        decltype(thing),
        decltype(i));
};
```

#### sus_class_trivial_relocatable(unsafe_fn)

The simplest but most risky macro is `sus_class_trivial_relocatable()`. This macro is like
`sus_class_assert_trivial_relocatable_types()` but without the additional help of the assertion
against the member types. When using this macro, the type should also be annotated with the
`[[clang::trivial_abi]]` attribute.

```cpp
struct sus_if_clang([[clang::trivial_abi]]) S {
    Thing<int> thing;
    int i;
    sus_class_trivial_relocatable(unsafe_fn);
};
```

#### sus_class_maybe_trivial_relocatable_types(unsafe_fn, types...)

The format of the macro is just like `sus_class_assert_trivial_relocatable_types()` but if any
type given to the macro is not trivially relocatable, the containing type will also not be.

Specifically, this allows a type to opt into being trivially relocatable if all of its members are
trivially relocatable, including template parameter types.

This macro is probably only worth using in a template, as otherwise the types are either known to
be trivially relocatable or to not, and the `sus_class_assert_trivial_relocatable_types()` macro
could be used in the former case. And since the condition can evaluate to false, the use of
`[[clang::trivial_abi]]` on such a class type would be a bug.

```cpp
template <class T>
struct S {
    Thing<T> thing;
    T t;
    sus_class_maybe_trivial_relocatable_types(
        unsafe_fn,
        decltype(thing),
        decltype(t));
};
```

The behaviour of `sus_class_maybe_trivial_relocatable_types()` is much like the extensions to
the compiler proposed in
[P1144R6](https://www.open-std.org/jtc1/sc22/wg21/docs/papers/2022/p1144r6.html). 

#### sus_class_trivial_relocatable_value(unsafe_fn, bool)

The `sus_class_trivial_relocatable_value()` macro receives a boolean argument that will be
constant evaluated and used to determine if the type is ultimately marked as trivially relocatable
or not. This is useful when the condition is more complex than just whether the members of the type
are themselves trivially relocatable, but the caller can make use of
`sus::mem::relocate_by_memcpy<T>` to check members as well.

This macro is probably only worth using in a template, as otherwise the condition should be able to
be determined by the author. And since the condition can evaluate to false, the use of
`[[clang::trivial_abi]]` on such a class type would be a bug.

```cpp
template <class T>
struct S {
    Thing<T> thing;
    T t;
    sus_class_trivial_relocatable_value(
        unsafe_fn,
        StuffAbout<T> &&
        sus::mem::relocate_by_memcpy<decltype(thing)> &&
        sus::mem::relocate_by_memcpy<decltype(t)>);
};
```

The `sus_class_trivial_relocatable_value()` macro is most similar to the proposed
`[[trivially_relocatable(bool)]]` attribute in
[P1144R6](https://www.open-std.org/jtc1/sc22/wg21/docs/papers/2022/p1144r6.html).

### Using trivially relocatable

Wow that turned into a lot more text than I thought it would. Finally we can talk about what all of
this machinery is for. How we use trivial relocation in Subspace.

Since we can't change the language itself, we can't use trivial relocation unless we have control
over the execution of the destructor. As such, Subspace provides or does the following.

#### swap(a, b)

The `sus::mem::swap(a, b)` function will swap the contents of `a` and `b` by using `memcpy()` if the
objects' type is `sus::mem::relocate_by_memcpy()`. This is mentioned in [P1144R6](
https://www.open-std.org/jtc1/sc22/wg21/docs/papers/2022/p1144r6.html#benefit-swap) to show
[large binary-size improvements](https://p1144.godbolt.org/z/PPYhcYd8d) for any algorithm that is
implemented with swap, and we can
[see the same improvements](https://p1144.godbolt.org/z/essMnWq8h) from Subspace's
`sus::mem::swap()`. Of course, this function will only copy `sus::mem::data_size_of<T>()` many
bytes to avoid clobbering unrelated types in the process.

```cpp
template <class T>
  requires(sus::mem::Move<T>)
constexpr void swap(T& lhs, T& rhs) noexcept;
```

#### sus::Vec

The `sus::Vec` (technically `sus::containers::Vec`) type will avoid moving each element in the
vector's storage when resizing if the types are `sus::mem::relocate_by_memcpy()`. When that is the
case it will simply `realloc()` to resize the memory which copies the contents of the memory to the
new allocation. And sometimes this doesn't need to copy at all if the allocation did not move!

This is also mentioned in [P1144R6](
https://www.open-std.org/jtc1/sc22/wg21/docs/papers/2022/p1144r6.html#benefit-resize) where it
claims a 3x speedup for the same.

#### Future work

We'll continue to take advantage of trivially relocatable whenever possible. In general it requires
two considerations to be useful:

1. Control over the source object's lifetime, to avoid running its destructor after relocating.
1. A preexisting object in the final destination, to avoid having to run a constructor before
   relocating.

As such, outside of swap, this mostly comes up in containers. We should be able to leverage it
again in structures like a flat hash map, in sorting, or inserting into a vector.

### Thanks

I really want to thank [@Quuxplusone](https://github.com/Quuxplusone) for his work on
[P1144R6](https://www.open-std.org/jtc1/sc22/wg21/docs/papers/2022/p1144r6.html) as I was able to
generate both fixes and improvements to the Subspace library while writing this blog post and
considering his proposal work. I hope that it will make its way into the language in a way
that's maximally useful (with the boolean argument in `[[trivially_relocatable]]`).

I also want to thank [@ssbr](https://github.com/ssbr) for his keen insights on "data size" which
have provided for a sound implementation of trivial relocation in `sus::mem::swap()`.