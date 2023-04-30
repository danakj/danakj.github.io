---
tags:
- Subspace
- C++
---

# Subspace Update: Slices, Vec, and Generators

I've spent a few months mostly working on an enormous branch, so Subspace hasn't seen a lot of
changes on `main`. Today I merged a lot of stuff, which makes it a good time to mention some of the
new things.

## Slices and Vec

Micro post: [https://sunny.garden/@blinkygal/110289198753682615](https://sunny.garden/@blinkygal/110289198753682615)

Today in Subspace I finished and merged all the methods for [Slice](
https://danakj.github.io/subspace-docs/sus-containers-Slice.html) and [SliceMut](
https://danakj.github.io/subspace-docs/sus-containers-SliceMut.html).

`Slice<T>` is a const reference to a contiguous range of `const T` (like a `std::span<const T>`),
while `SliceMut<T>` is a mutable reference to a contiguous range of `T` (like a `std::span<T>`).
Why are these different types? First, this allows the default, shorter wording to be the safer and
preferred one: const is default. Secondly, it's not possible to `sort()` on a Slice, but if they
were one type, it would require all methods that require mutable access to the pointed-to range to
be qualified with `requires (!std::is_const_v<T>)`. The API gets harder to understand and to use as
a result. This way, the SliceMut has methods that allow mutation, and Slice simply does not.

There are 95 methods in all! I started working on these two months ago on March 3. The
Pull Request is here: https://github.com/chromium/subspace/pull/218/.

I'm kinda relieved to finally get through them all. There's lots of useful stuff in there though,
including:
* searching
* sorting
* splitting
* sub-slicing with ranges (including range literals)
* iterating (forward and reverse) on splits, chunks, and sliding windows
* joining
* filling or repeating
* working with prefixes and suffixes
* swapping
* reordering

These methods all appear on [Vec](https://danakj.github.io/subspace-docs/sus-containers-Vec.html))
as well, which is an owning Slice. In addition, Vec is usable in all places that a Slice or SliceMut
(if the Vec is not const) would be usable (except as an rvalue, which would allow references to
escape from a temporary object). And similarly SliceMut is usuable anywhere a Slice would be.

There's lots of room for performance tuning, I am sure, and some TODOs left in this regard. As
always everything comes with unit tests, so making future changes can be done with confidence.

# Range literals

In the C++ standard library, the `std::span` type allows subslicing through the `subspan(offset)`
and `subspan(offset, count)` overloads (implemented as a default argument). Then,
`s.subspan(offset)` in C++ is equivalent to `s[offset..]` in Rust and `s.subspan(offset, count)` in
C++ is equivalent to `s[offset..(offset + count)]` in Rust.

But Rust is more expressive here. Its [RangeBounds](
https://doc.rust-lang.org/stable/std/ops/trait.RangeBounds.html) can describe any possible range
with or without a front edge or back edge. `..` is everything, `2..` starts from 2 and goes to the
end, `..5` starts at the beginning and stops at 5 (excluding 5), and `2..5` starts at 2 and ends at
5 (excluding 5). It even allows `2..=5` to include 5 in the bounds.

Instead of providing a bunch of overloads for this type of expressivity, Subspace slices (and Vec)
can be subsliced using the `operator[](sus::ops::RangeBounds<usize> auto)` operator, which aborts if
given a range out of bounds, or `get_range(sus::ops::RangeBounds<usize> auto)` and
`get_range_mut(sus::ops::RangeBounds<usize> auto)` which return a `sus::Option` holding nothing
if out of bounds or a `Slice` (or `SliceMut` respectively) otherwise.
The `RangeBounds` concept is satisfied by a set of types provided in `sus::ops` that specify
a start, an end, both, or neither:
* `sus::ops::Range` has a start and end (exclusive).
* `sus::ops::RangeFrom` has a start, with an unbounded end.
* `sus::ops::RangeTo` has an end, with an unbounded start.
* `sus::ops::RangeFull` represented an unbounded start and end.

For dynamic values, these can be constructed from numeric values as they are aggegrate types. For
constant values, a literal syntax is provided. C++ doesn't let us have all the nice things, so we
can't use the exact literal syntax from Rust, as C++ requires non-quoted literals to parse as
numbers even if you're going to do the parsing yourself. But we get this:
* `"3..7"_r` is a `Range<usize>` from 3 to 7 (exclusive).
* `"3..=7"_r` is a `Range<usize>` from 3 to 7 (inclusive).
* `"3.."_r` is a `RangeFrom<usize>` that starts at 3.
* `"..7"_r` is a `RangeTo<usize>` that ends at 7 (exclusive).
* `".."_r` is a `RangeFull<usize>` that represents an unbounded range.

Range types can be modified to produce new ranges with the `.start_at()` and `.end_at()` methods.
These change, or add, a start or end bound, changing the type of the object when a new bound is
added. For instance `::sus::ops::RangeFull().start_at(3)` makes a `::sus::ops::RangeFrom(3)`.

Mixing literal values with dynamic values is possible as well with these methods, such as a range
that starts at 5, but ends at `x`: `"5.."_r.end_at(x)`.

Certainly this is nowhere as nice as Rust's `5..x` syntax. Maybe C++ can give us that one day. But I
want to provide the tools to write literal ranges when code authors would benefit from doing so, and
the Range type aggregate constructors are always available too.

Bringing this back to slices, a Vec can produce a slice for any range using its `operator[]`,
`get_range()` or `get_range_mut()`:
```cpp
auto vec = sus::Vec<i32>::with_values(1, 2, 3, 4, 5);

auto s1 = vec[".."_r];  // A SliceMut over [1, 2, 3, 4, 5].
auto s2 = vec["3.."_r];  // A SliceMut over [4, 5].
auto s3 = vec["..3"_r];  // A SliceMut over [1, 2, 3].
auto s4 = vec["2..3"_r];  // A SliceMut over [3].
```

Lastly, for signed ranges, there's also a `_rs` literal suffix that produces ranges over `isize`
instead of `usize`, such as `"3..12"_rs` to make `sus::ops::Range<isize>(3, 12)`. But slices always
work with ranges over `usize`.

# Iterators

While I was slogging through the slice methods, I also added some exciting iterator features.

## Generator functions

Micro post: [https://sunny.garden/@blinkygal/110044818048764779](https://sunny.garden/@blinkygal/110044818048764779)

It's now possible to write an Iterator that will compose nicely with all the existing Iterator
methods, but as a single function, instead of having to write a whole type. This is thanks to C++
coroutines, as they allow writing a generator function to modify iteration.

This provides a means to write "control flow" into an iteration, in the spirit of
https://without.boats/blog/the-registers-of-rust/.

Here's the generator unit tests to demonstrate what I mean.

Here the `x()` function produces an iterator over the set `1, 2, 3, 4`. This is composed with the
`filter()` method that keeps only things in the range `(1, 4)` (exclusive). The result is `2, 3`.

```cpp
TEST(IterGenerator, ComposeFromGenerator) {
  auto x = []() -> Generator<i32> {
    co_yield 1;
    co_yield 2;
    co_yield 3;
    co_yield 4;
  };

  // Generator is trivially relocatable, so no need to box() it.
  sus::iter::Iterator<i32> auto it =
      x().filter([](const i32& a) { return a > 1 && a < 4; });
  EXPECT_EQ(it.next().unwrap(), 2);
  EXPECT_EQ(it.next().unwrap(), 3);
  EXPECT_EQ(it.next(), sus::None);
}
```

Here the `x()` function composes with an input iterator, and it does the same as the `filter()`
call above, discarding anything outside the range `(1, 4)` (exclusive). It is chained with an
iterator from a `Vec<i32>` that contains `1, 2, 3, 4` and again the result is `2, 3`.

```cpp
TEST(IterGenerator, ComposeIntoGenerator) {
  auto x = [](sus::iter::Iterator<i32> auto it) -> Generator<i32> {
    for (i32 i : it) {
      if (i > 1 && i < 4) co_yield i;
    }
  };

  sus::iter::Iterator<i32> auto it =
      sus::vec(1, 2, 3, 4).construct<i32>().into_iter().generate(x);
  EXPECT_EQ(it.next().unwrap(), 2);
  EXPECT_EQ(it.next().unwrap(), 3);
  EXPECT_EQ(it.next(), sus::None);
}
```

## Enumerate

Micro post: [https://sunny.garden/@blinkygal/110223458907555381](https://sunny.garden/@blinkygal/110223458907555381)

I also have added `Iterator::enumerate`. Adding the `sus::iter::Enumerate` type was fairly trivial,
but in order to iterate backwards, as a `sus::iter::DoubleEndedIterator`, it needs to know the total
length of the iteration sequence. That is, the iterator needs to also be a
`sus::iter::ExactSizeIterator`. While these concepts were already present in the library, I had not
plumbed them through composing iterator types. So that is now done.

This means calling `filter()`, or `map()` on a `DoubleEndedIterator` will produce another
`DoubleEndedIterator`. And when possible, such as when calling `rev()` on an `ExactSizeIterator`,
the resulting reversed iterator will also be an `ExactSizeIterator`. And in the case of
`enumerate()`, if the input iterator was a `DoubleEndedIerator` and `ExactSizeIterator`, the output
iterator will also be.

Notably, iterators over an Vec or Array are double-ended and have an exact known size and thus
satisfy these traits.

Here's an example where we have an iterator over `1, 2, 3, 4, 5`. It is double-ended and its exact
size is known. The iterator is reversed with `rev()`, so it will output `5, 4, 3, 2, 1`. Then it
is composed with `enumerate()` which means each step includes the position in the iteration
sequence.

The numerics are casted to primitives to print, as I did not yet decide on a path for [integrating
with streams](https://github.com/chromium/subspace/issues/235) or to otherwise print things.

```cpp
auto chars = Vec<char>::with_values('a', 'b', 'c', 'd', 'e');

{
  auto it = sus::move(chars).into_iter().rev().enumerate();

  // enumerate() makes an iterator over a Tuple of position and value.
  using E = sus::Tuple<usize, char>;
  static_assert(sus::iter::Iterator<decltype(it), E>);
  // The output iterator of enumerate() is a DoubleSidedIterator and
  // ExactSizeIterator.
  static_assert(sus::iter::DoubleEndedIterator<decltype(it), E>);
  static_assert(sus::iter::ExactSizeIterator<decltype(it), E>);

  // The output the position paired with the reversed values.
  for (auto [pos, val]: it) {
    // Prints:
    // (0, e)
    // (1, d)
    // (2, c)
    // (3, b)
    // (4, a)
    std::cerr << "(" << size_t{pos} << ", " << val << ")\n";
  }
}
```

## Stdlib Ranges

Subspace's first stdlib compatability hook with the C++ standard library was added, with conversions
from sus::iter::Iterator types to C++ ranges.

Calling `.range()` on any iterator will produce a `std::ranges::range` output, which satisfies the
[`std::ranges::input_range`](https://en.cppreference.com/w/cpp/ranges/input_range) concept.

Here are some unit tests that demonstrate the behaviour, showing that the output from `.range()` is
usable as a `std::ranges::viewable_range` and a `std::ranges_input_range`. In these examples, the
iterator owns the values as `vec` is consumed to produce the iterator through `into_iter()`.

```cpp
TEST(CompatRanges, ViewableRange) {
  sus::Vec<i32> vec = sus::vec(1, 2, 3, 4, 5, 6);

  // all() requires a `std::ranges::viewable_range`.
  auto view = std::ranges::views::all(sus::move(vec).into_iter().range());

  i32 e = 1;
  for (i32 i : view) {
    EXPECT_EQ(e, i);
    e += 1;
  }
  EXPECT_EQ(e, 7);
}

TEST(CompatRanges, InputRange) {
  sus::Vec<i32> vec = sus::vec(1, 2, 3, 4, 5, 6);

  // filter() requires a `std::ranges::input_range`.
  auto filter = std::ranges::views::filter(sus::move(vec).into_iter().range(),
                                           [](const i32& i) { return i > 3; });

  i32 e = 4;
  for (i32 i : filter) {
    EXPECT_EQ(e, i);
    e += 1;
  }
  EXPECT_EQ(e, 7);
}
```
