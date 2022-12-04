## Writing a Tagged Union type in C++/Subspace

First blog post! The hardest part of writing blog posts about Subspace has been setting something
up, and starting. So let's just dive in. I will write an introduction to
[Subspace](https://github.com/chromium/subspace) in another post another day. Today, let's talk
about Undefined Behaviour.

### Tagged Union

A tagged union is a combination of two familiar C++ things: an `enum` and a `union`. At a high
level, you have a set of values and some data to associate with each one. So a tagged union is some
set of data attached to each value in the `enum`, with the data held in a `union`.

In old C++, you would have to do this by literally writing a tag and a union.
```cpp
struct HoldsThings {
    enum TypesOfThings {
        Car,
        House,
        Poetry,
    } tag;
    union {
        // Associated with `TypesOfThings::Car`.
        struct {
            std::string model;
        } car;
        // Associated with `TypesOfThings::House`.
        struct {
            int number;
            std::string street;
        } house;
        // Associated with `TypesOfThings::Poetry`.
        std::string poetry;
    } data;
};
```

The structure is very free-form, and it's up to the author to ensure they actually access the right
data at the right time.

Unions have some very strict rules in C++, including:
* At most one member at a time is active (there can be zero active members).
* A member is made active by writing to it.
* Reading from a non-active member is **Undefined Behaviour**.

So if any user of `HoldsThings` messes up and reads or writes to a union member that is not correct
for the current `tag`, the result will be Undefined Behaviour. It also requires a lot of clunky
code.

#### C++17 and std::variant

C++17 introduces std::variant, which provides a tagged union, except
[over a `size_t`](https://en.cppreference.com/w/cpp/utility/variant/get) instead of over an enum. If
you have a mapping from an enum to size_t then you can essentially use it as a tagged enum.
A variant can be read or written into by selecting based on the type of the member, but this
provides no easy way to map between enum values and variant members, so we ignore it here.

This is a big improvement over rolling it yourself. If you `std::get()` to read an inactive member,
the `std::variant` will throw an exception.

So are we done? This still requires developers to map between enum values and `size_t`. And enum
values need not be contiguous, while the indices of a varint are, giving lots of chances for bugs.
Because of this, I decided I wanted to provide a true tagged union in Subspace.

### Rust Enums

Rust has an `enum` keyword as well, but it natively allows you to attach data to each value in the
enum, which means they are a tagged union. Pat Shaughnessy does a great job explaining [how Rust
enums are implemented](https://patshaughnessy.net/2018/3/15/how-rust-implements-tagged-unions) in
terms of how their data is stored. And in the comments, Ingvar Stepanyan made a very interesting
point, which I will quote here:

> 1) In fact, what Rust uses for its representation is more like
> 
> ```cpp
> union tagged_num_or_str {
>   struct num { char tag; short num; } num_variant;
>   struct str { char tag; char *str; } str_variant;
> };
> ```
> The difference, while obscure, is actually important for alignment and size optimisation. For
> example, if you add one more u16 field to each variant, you'll get:
> 
> ```cpp
> union tagged_num_or_str {
>   struct num { char tag; short data; short num; } num_variant;
>   struct str { char tag; short data; char *str; } str_variant;
> };
> ```
> which is 16 bytes and not
> 
> ```cpp
> struct tagged_num_or_str_2 {
>   char tag;
>   union {
>       struct {
>           short data;
>           short num;
>       } num_variant;
>       struct {
>           short data;
>           char *str;
>       } str_variant;
>   };
> };
> ```
> which is 24 bytes.

This thoroughly nerd-sniped me. Could I do the same in C++?

### Into the alignment rabbit hole

First, what does std::variant do? It does the naive thing, putting the tag outside the structures,
which makes sense given that it has no control over the storage types within. In this case, each
storage type is a tuple, and variant can't just randomly stick a `tag` field into them.

```cpp
  auto v = std::variant<std::tuple<i8, u32>, std::tuple<i8, u64>>();
  static_assert(sizeof(decltype(v)) == sizeof(u64) * 3u);  // Tag is outside.
```
I will have to introduce the integral types in another post, treat `i32` as `int32_t` *etc.* for
now.

Here the size is dominated by the larger `std::tuple<i8, u64>`. Inside the tuple we can
conceptually think of the storage as:
```cpp
struct {
    i8 field1;   // 1 byte.
                 // 7 bytes of padding for the `u64` to be aligned correctly.
    u64 field2;  // 8 bytes.
};
```

This takes up 16 bytes so far. Then the std::variant needs to add a tag in front. Let's say it is
only 1 byte:
```cpp
struct variant {
    u8 tag;    // 1 byte.
               // 7 bytes of padding for the `struct` with `u64`-alignment to be aligned correctly.
    struct {
        i8 field1;   // 1 byte.
                     // 7 bytes of padding for the `u64` to be aligned correctly.
        u64 field2;  // 8 bytes.
    };
};  // Total: 24 bytes.
```

The compiler is forced to put 7 bytes of padding below the tag, because the padding below `field1`
is fixed. Skipping that padding would mis-align the `u64` member, resulting some more Undefined
Behaviour. This results in the size of our std::variant being `3 * sizeof(u64)`, or 24 bytes, even
though _it only holds 10 bytes of interest_.

Sticking the tag into the inner struct would remove 7 bytes of padding below `tag`, and 1 byte of
padding below `field1`, which could reduce the size of the variant to 16 bytes, which is the minimum
possible size for this combination of values.
```cpp
struct variant {
    struct {
        u8 tag;     // 1 byte.
        i8 field1;  // 1 byte.
                    // 6 bytes of padding for the `u64` to be aligned correctly.
        u64 field2; // 8 bytes.
    };
};   // Total: 16 bytes.
```

### Stashing the tag in each Union member

Subspace is all about rethinking assumptions about how a C++ library should be written. Above we
said std::variant has no control over the inner types, so it has to put the tag outside them. So
what happens if we throw that assumption away?

Here's a possible `sus::Union` with the same data as from the `std::variant` example. But notably
without the use of `std::tuple`, which was a key part of the type we named above.

```cpp
union Union {
    struct {
        u8 tag;     // 1 byte.
        i8 field1;  // 1 byte.
                    // 2 bytes of padding for the `u32` to be aligned correctly.
        u32 field2; // 4 bytes.
                    // 8 bytes of padding to have the same size as the struct below.
    }
    struct {
        u8 tag;     // 1 byte.
        i8 field1;  // 1 byte.
                    // 6 bytes of padding for the `u64` to be aligned correctly.
        u64 field2; // 8 bytes.
    };
};  // Total: 16 bytes.
```

We have a tagged union that optimizes its storage space. Looks great, ship it! Let's find an API
that can support it!

Except, there's one problem. Remember how the C++ spec only allows you to read from the active
member of the union? In order to know which element of the tagged union is active, we need to read
the tag, but we can't read the tag unless we know which tag to read. So this sounds like instant
Undefined Behaviour if we actually use the tag.

But the C++20 standard has some additional rules that can save us here. The cppreference docs for
union have a [single sentence](https://en.cppreference.com/w/cpp/language/union#Explanation) which
aludes to this:
> If two union members are standard-layout types, it's well-defined to examine their common
> subsequence on any compiler.

But this is actually more general than what the spec allows, so let's look at that text instead:
> One special guarantee is made in order to simplify the use of unions: If a standard-layout union
> contains several standard-layout structs that share a common initial sequence (11.4), and if a
> non-static data member of an object of this standard-layout union type is active and is one of the
> standard-layout structs, it is permitted to inspect the common initial sequence of any of the
> standard-layout struct members; see 11.4

The tag is part of the "common initial sequence" of each structure in our union since it:
* Is at the front of each structure, so there's nothing not-in-common before it.
* It has the same layout in each structure.

But this exception has a very big disclaimer: the structures must be [Standard-Layout types](
https://en.cppreference.com/w/cpp/named_req/StandardLayoutType).  This isn't a property we have to
think about a lot in day-to-day C++ work, but it turns out that it is critical to the rules of how
you can use a C++ union. The property can be checked by the [`std::is_standard_layout`](
https://en.cppreference.com/w/cpp/types/is_standard_layout) type trait, and indeed integers (and our
`i8` and friends) are standard layout. So this would actually work well for the types given here!
*We can have a minimally-sized tagged union in C++.*

### Troubles with Standard-Layout

A class is a Standard-Layout type, according to cppreference if it:
> * has no non-static data members of type non-standard-layout class (or array of such types) or
>   reference,
> * has no virtual functions and no virtual base classes,
> * has the same access control for all non-static data members,
> * has no non-standard-layout base classes,
> * only one class in the hierarchy has non-static data members, and
> * none of the base classes has the same type as the first non-static data member.

I got through most of these rules with increasing joy until I reached: "only one class in the
hierarchy has non-static data members". Ah... tuple. Tuple is the way to define a type in the
template system that mixes together heterogeneous types.

The implementation of tuple is up to the library to define, but C++ does place some limitations on
us. Inheritance is *the* tool that the language gives us for this.

The `std::tuple` in libc++ is (as of Dec 2022) implemented roughly as [subclassing from a holder
for each type in the tuple](
https://github.com/llvm/llvm-project/blob/c95922c717973889ee669066abfc2e8be07050bf/libcxx/include/tuple#LL447C41-L447C41).
Simplified as:
```cpp
template <class... Ts>
struct tuple : Ts... {};
```

This means that there are `sizeof...(Ts)` many classes in the hierarchy with non-static data
members. So tuple can not be standard layout (at least not with more than 1 value in it).

Another way to implement this would be to have tuple subclass a series of base classes, each one
holding one type. This is the [initial implementation](
https://github.com/chromium/subspace/blob/e3964bc4788c466509a0f6dd37e3a0ca8795c5ab/tuple/__private/storage.h#L82-L90)
of `sus::Tuple`, though the libc++ implementation makes me wonder if it performs better (for compile times?).

If our tagged union wants to build a type that includes a `tag` and some user-defined types, it is
going to have to do it with a tuple, and one with at least 2 members:
```cpp
union Union {
    tuple<tag, T1> a;
    tuple<tag, T2> b;
}
```

Since `tuple<tag, T>` is not a Standard-Layout type, our Union type can not access the tag as we
hoped for without incurring Undefined Behaviour. This means the tag has to be pulled out of `a` and
`b`, just as in std::variant.

### Can we avoid tuples?

Many types in a program are not Standard-Layout types, including tuples. But could we get minimally-
sized tagged unions for the times when all the types inside are Standard-Layout types? To do so, we
can't use tuples, nor inheritence to generate the types stored in the Union. The other tool we have
to compose hetergeneous types is `struct`.

Given no boundaries on the API shape, I set out to see if we could generate structs with a tag field
each to hold in the tagged union.

Generating a struct with the [`sus_for_each()`](
https://github.com/chromium/subspace/blob/e3964bc4788c466509a0f6dd37e3a0ca8795c5ab/macros/for_each.h#L17-L24)
macro is easy enough, if we have the set of types.
```cpp
struct {
    u8 tag;
    i8;
    u32;
};
```

But with a struct, we have to give them unique names. So I modified the `sus_for_each()` macro
to concat a symbol like `f` to itself recursively.

```cpp
struct {
    u8 tag;
    i8 f;
    u32 ff;
};
```

While building out the [`sus::Tuple`](
https://github.com/chromium/subspace/blob/e3964bc4788c466509a0f6dd37e3a0ca8795c5ab/tuple/tuple.h#L32-L34)
type, I came across an interesting piece of structured bindings. When structured bindings are
applied to a struct, the compiler will bind the fields of that struct in order. This means that
while we have to generate unique names for the struct fields, we don't need to know them to refer to
them! In the example below, `a` and `b` will references to `s.f` and `s.ff` respectively.

```cpp
struct S {
    i8 f;
    u32 ff;
} s;

auto& [a, b] = s;
```

But C++ was not designed to build structs like this in the middle of a type declaration. While
we can write `std::variant<std::tuple<i32, i32>>`, we can not write
`std::variant<struct { i8 f; u32 ff; }>`. The spec disallows it, and the compiler errors look like
the following.
* Clang: error: declaration of anonymous struct must be a definition.
* GCC: error: types may not be defined in template arguments.
* MSVC just completely doesn't parse it: error C2947: expecting '>' to terminate
template-argument-list, found '>'.

Having the user of the Union type declare the structs themselves isn't an option, as they would
need to put a tag inside them. At best, we could use a macro to define a structure with a tag,
then pass that type to the Union.
```cpp
// A struct with generated internals. Still leaves room for error if something is added to the
// struct above the macro.
struct S {
    sus_union_types(i8, u32);
};
// Or this could generate a struct named S.
sus_union_struct(S, i8, u32);

auto u = Union<S>;
```

This approach could generate a struct with a special tag so that Union ensures the `sus_union_types`
macro is used. But it hides a lot behind a macro, to the point of making it unclear what is
happening in this code at all. And so I abandoned trying to get a minimally-sized tagged union in
C++ after all.

### Union API choices

The points that felt important in the design of the Union API were:
1. It should be clear that a `sus::Union` type is being defined.
1. It shouldn't require the storage types to be defined externally.
1. It should make it as clear as possible which enum value is tied to what storage types.
1. Hard to use wrong, easy to understand what's happening.

The candiates I landed on were as follows.

This API here has a struct `U` declare the type associated with each enum value as fields. This
fails our goals by requiring the type `U` to be declared beforehand. It's also unclear what's going
on, as the fields each correspond to one enum value, which feels surprising.
```cpp
struct U {
    i8 i;
    u32 f;
};
auto u = Union<U, Smurfs::Papa, Smurfs::Mama>();
```

This API is kinda what you'd expect if you took a std::variant and put enums into it. Instead of
receiving a list of types, it receives a tuple of a list of types. Then an enum value for each
type listed in the tuple. It fails our goals in that it's easy to get things wrong. Once you get to
15 enum values and types, it gets very hard to tell which type is for which enum value. While you'd
like to think that you would get a compiler error for getting the wrong type, you may instead just
get implicit type conversions.
```cpp
auto u = Union<Tuple<i8, u32>, Smurfs::Papa, Smurfs::Mama>();
```

This API uses a macro to pair each enum value clearly with the type attached to it. This satisfies
the problems of the previous API, but it fails our goals as well. It is not obvious that this
defines a `Union` type. A macro here could evaluate to pretty much anything.
```cpp
auto u = sus_union((Smurfs::Papa, i8), (Smurfs::Mama, u32));
```

This API is where I eventually landed so far. We use a macro to define pairs of enum values and
types, which get transformed into a shape closer to `Tuple<int, float>, Smurfs::Papa, Smurfs::Mama`
internally. Macros can be magic, but placed inside the template variables of the `Union`, we know
the union is defining the structure of the Union.
```cpp
auto u = Union<sus_type_pairs((Smurfs::Papa, i8), (Smurfs::Mama, u32))>();
```

Then, going a step further, I wondered if we need to only have one type per enum value. A Rust enum
can define many types:
```rust
enum Smurfs {
    Papa(i8, u32),
    Mama(u64),
}
```

By the power of nesting more `sus_for_each()` macros, we can get the same with our `sus::Union`
type. Then accessing the storage associated with an enum value will either give the single type
stored within, or in the case of multiple types, a Tuple of all of them.

```cpp
auto u = Union<sus_type_pairs((Smurfs::Papa, i8, u32), (Smurfs::Mama, u64))>();

u.get_ref<0>();  // Returns a `Tuple<const i8&, const u32&>`.
                 // Which means you can use structured bindings:
const auto& [a, b] = u.get_ref<Smurfs::Papa>();
// `a` is `const i8&`.
// `b` is `const u32&`.

u.get_ref<Smurfs::Papa>();  // Returns a `const u64&`.
```

This tagged union type will eliminate programming errors and Undefined Behaviour, and I hope will
lead to better API designs in C++ programs, by making it easier and more natural to have types
exist only when they are valid to be used.

This Union type's implementation is now happening in [Subspace PR #99](
https://github.com/chromium/subspace/pull/99).