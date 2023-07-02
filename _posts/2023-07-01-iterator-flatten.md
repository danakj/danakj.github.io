---
tags:
- Subspace
- C++
- Rust
description: Comparing the implementation of a generic trait-based API in C++ and in Rust.
---

# Implementing Iterator::flatten() in C++ and in Rust

You may have heard that C++ has concepts in version 20. You may have heard these compared to traits in Rust. Indeed you can do many of the same things with them. Today I found them to be a good demonstration of the complexity of writing #Cpp vs #Rust.

Here’s the Iterator::flatten() method in Rust: https://doc.rust-lang.org/stable/std/iter/trait.Iterator.html#method.flatten

![The Rust Iterator::flatten() method](/resources/2023-07-01-iterator-flatten/flatten-1.png)

The Items in the Iterator need to each be convertible to an Iterator as well. Then the resulting Iterator will return all the items from those Iterators. As in “Iterator[Iterator[i32]] => Iterator[i32]”.

## IntoIterator

IntoIterator is the trait that flatten() used, if it’s satisfied, the type can be converted to an Iterator via calling into_iter(): https://doc.rust-lang.org/stable/std/iter/trait.IntoIterator.html

![The Rust IntoIterator trait](/resources/2023-07-01-iterator-flatten/flatten-2.png)

The trait has an associated type called Item, which is what the created Iterator will return.

It requires that the type returned by into_iter() actually implements Iterator by constraining it with the IntoIter rule.

## The Iterator::flatten() implementation

The actual implementation of flatten() is a single function call: https://doc.rust-lang.org/stable/src/core/iter/traits/iterator.rs.html#1587-1590

![The Rust Iterator::flatten() implementation](/resources/2023-07-01-iterator-flatten/flatten-3.png)

Which creates a Flatten type that is the resulting iterator, the “IntoIter” type mentioned in the IntoIterator trait above.

## The Flatten iterator type

The Flatten type is also pretty simple. The implementation relies on a FlattenCompat abstraction to share implementation with flat_map(): https://doc.rust-lang.org/stable/std/iter/struct.Flatten.html

![The Rust Flatten type](/resources/2023-07-01-iterator-flatten/flatten-4.png)

The where clause on Flatten points out once again that the Items in the outer Iterator can be converted to (or are) Iterators themselves.

## The Flatten implementation

The Flatten::next() method, which is used to implement the Iterator trait returns a U::Item type: https://doc.rust-lang.org/stable/src/core/iter/adapters/flatten.rs.html#204-212

![The Rust Flatten type's implementation of the Iterator trait](/resources/2023-07-01-iterator-flatten/flatten-5.png)

The bound here requires that the Iterator we’re flattening has Items that satisfy IntoIterator, and we assign names to the associated types in IntoIterator.

The U is a name we assign to the return type of the into_iter() method in the IntoIterator trait, as we see by the assignment to IntoIter. The Items from those inner iterators are U::Item.

So now we’re going to return from the Flatten type’s Iterator implementation the inner types. This is not the most simplest of APIs but the type relationships are pretty straightforward.

What does this look like in C++ Subspace?

#CppSubspace

## Iterator::flatten() in C++

Here’s the C++ version of Iterator::flatten(). It’s in the IteratorBase class, not the Iterator concept. In Rust this goes directly in the trait, but you can’t add default methods to a C++ concept as they only provide boolean yes/no matching against types. So instead this lives on IteratorBase, which all Iterator types are required to inherit from (as final) in order to satisfy the Iterator concept.

![The C++ version of Iterator::flatten()](/resources/2023-07-01-iterator-flatten/flatten-6.png)

The method has a concept requirement, much like the Rust trait bound on IntoIterator. But it’s called IntoIteratorAny. Why the “Any” part?

## The IntoIterator concept in C++

We have an IntoIterator concept in C++ too. It has a type T which is the type that can be converted to an Iterator, and something like Rust’s associated type, Item, as a second template parameter.

![The C++ IntoIterator concept](/resources/2023-07-01-iterator-flatten/flatten-7.png)

If a type satisfies IntoIterator, then we know it can convert to an Iterator that returns Items through the into_iter() method. And the return type of into_iter() is constrained to be satisfy the Iterator concept, like the Rust trait.

The C++ complexity cracks start to show here. In the Rust generics and type system when you have a type you.. Well you have a type. But in C++ you have to worry about whether that type is const, or volatile, or an lvalue reference, or a const reference, or an rvalue reference! You do some 6D chess in your head to figure out just what type of thing you want in all of those situations, which you want to accept or reject.

Here we don’t care about reference input types, we want to know that when we have an rvalue of the type, and we call into_iter() on it, we get an Iterator, so we need to use std::remove_cvref_t<T>. Hopefully that was the right choice, and not std::remove_const_t<std::remove_reference_t<T>> or some other configuration - it’s hard to ever be completely confident.

## Getting the IntoIterator Item type

But why didn’t we use IntoIterator on the flatten() method? Originally, I did that, as I’ve done with other methods, however for flatten() we don’t know apriori what the types are inside the inner Iterators.

That was not a problem in the Rust flatten() method at all, it constrained Self::Item to IntoIterator and moved on. But to use the IntoIterator concept in C++ we need to pass two types, the type-to-be-converted as well as the Item. But the Item is not known here. We can figure it out though, by seeing what Iterator type gets returned from into_iter() and getting the Item type off of it:

typename std::decay_t<decltype(std::declval<std::remove_cvref_t<Item>&&>().into_iter())>::Item

Lol. Since that’s not decipherable, here it is as a picture.

![The type traits to get the IntoIterator Item](/resources/2023-07-01-iterator-flatten/flatten-8.png)

But putting that in random code is horrifying.

## Adding the IntoIteratorAny concept in C++

So to avoid writing inscrutable type traits on our flatten() method, we shove it behind another concept, IntoIteratorAny. It’s a concept that is satisfied for a type that can convert to an Iterator through the into_iter() method, without placing a bound on the Item type of the returned Iterator:

![The C++ IntoIteratorAny concept](/resources/2023-07-01-iterator-flatten/flatten-9.png)

We don’t need two traits to express this same thing in Rust, but I have not found a way to avoid it and keep the flatten() method concise in C++.

## The body of Iterator::flatten() in C++

The body of the Rust flatten() method was simply Flatten::new(self). The C++ method has a bit more going on, all of which is hiding a ton of other machinery.

```cpp
  using Sized = SizedIteratorType<Iter>::type;
```

The Sized alias is a template instantiation of SizedIterator, which allows us to type-erase Iterator types, and then nest Iterators inside each other.

```cpp
  using Flatten = Flatten<typename IntoIteratorOutputType<Item>::Item, Sized>;
```

The sus::iter::IntoIteratorOutputType type alias is a helper used to figure out what Iterator type will be constructed from the call to into_iter() on a type that is IntoIterator. The Flatten type’s bounds in Rust allowed us to name that type U, as the trait has an associated type called IntoIter. Concepts in C++ don’t come with associated types, so you must use independent type inspection to get to it instead.

Here’s the implementation of IntoIteratorOutputType:

![The IntoIteratorOutputType type alias](/resources/2023-07-01-iterator-flatten/flatten-10.png)

Note that the IntoIteratorAny concept and the IntoIteratorOutputType alias were handled entirely by the generic bounds of the IntoIterator trait in Rust in a concise and simple way. C++ required a lot more typing, a lot more complexity, a lot more room for mistakes. You can express more too, but at what cost.

## The C++ Flatten Iterator type

Last, the method call to Flatten constructs the Flatten type which is the returned Iterator. We move “this” into the Flatten type by converting it into the SizedIterator.

```cpp
  return Flatten::with(make_sized_iterator(static_cast<Iter&&>(*this)));
```

The Flatten type is a class that subclasses InteratorBase, like we mentioned before. It’s `[[nodiscard]]`, which Rust achieves by putting the same in a single place, on the Iterator trait: https://doc.rust-lang.org/stable/src/core/iter/traits/iterator.rs.html#72. The “InnerSizedIter” is like the “I” type on the Rust version of Flatten. The `[[sus_trivial_abi]]` attribute marks the class as “clang::trivial_abi” if your compiler is Clang, which generates a warning on other compilers so has to go behind a macro.

![The C++ Flatten class](/resources/2023-07-01-iterator-flatten/flatten-11.png)

## Conclusion and Iterator concept

And with that we have the tools to write Iterator::flatten() in #Rust or in C++ with #SubspaceCpp.

For the interested, here’s the Iterator C++ concept, which has its fair share of worrying about const, references, and lvalue/rvalue-state embedded in the types:

![The C++ Iterator concept](/resources/2023-07-01-iterator-flatten/flatten-11.png)
