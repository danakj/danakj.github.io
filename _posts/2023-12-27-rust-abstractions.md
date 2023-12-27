---
tags:
- Rust
description: Building abstractions in Rust apps is very different from C++ and Java, and the education and tools aren't yet enough.
---
# How to Build Abstractions in Rust Applications: The Missing Rung on the Rust Education Ladder

I read yet another reddit post where an OO developer struggles with building abstractions in Rust. These things feel familiar to me, I have had the same struggles moving from being a C++ developer to building a non-trivial Rust application and trying to put abstractions throughout to reduce coupling. And I see colleagues at work ask the same things as they start to pick up Rust.

[https://www.reddit.com/r/rust/comments/18rme0v/interface_abstractions_in_rust/](
https://www.reddit.com/r/rust/comments/18rme0v/interface_abstractions_in_rust/)

To me, the most helpful reply in here was a reframing or changing of perspective. Instead of building a storage system, which is behaviour and state wrapped up in a typed object, build a function that needs to use a storage system and provide the *functions* it needs through a generic trait.

Another way of saying this could be to move the abstraction out of the incoming object (a virtual object) and into the function signature (a generic function). But I feel like it does not really explain *why* that is better, though it is more idiomatic. In fact, you could reword what I just said as “use `impl T` instead of `Box<dyn T>`” but that seems to miss the actual point that is hiding inside this advice.

Another way to think about it could be in terms of design direction. Write the code that needs the trait first, then define the trait in terms of what was needed, and provide the impl. But what if you have two teams, and you want one to go build the storage system for the other team? You don’t want to block on them building their application on top of some no-op storage system which you will then later use to design an API with. You want the storage system team to go write an API and provide it as a service. How it's consumed, by generic or trait object, is not ineherently tied to the order in which they are developed, but it has big implications for how the abstraction is used and built. And since working with concrete types is very different from working with trait objects, starting from concrete types can lead to a better outcome without explicitly stating the underlying intentions.

There’s an intense need for OO developers to build a typed object that provides functionality. That is a basic part of the recipe for abstraction C++ and Java. So it’s extremely natural for devs to end up at `Box<dyn T>`, which provides for this need but does so very poorly and in a way that ends up feeling like you’re fighting the Rust language.

Trait objects can be useful for small independent implementations with a narrow scope (like an iterator, or a closure), but as a tool for building application abstractions they impose a ton of pain on both the implementor of the abstraction and the consumer. For the implementor, they end up building *everything* into this one trait. Even `Clone`, as we see mentioned in the above Reddit discussion. Downcasting is another example which you have to roll yourself through your trait API. Then the consumer of your trait can’t make use of standard vocabulary and traits, and everything becomes quite full of friction and complexity.

Since trait objects APIs become monolithic, they lead developers toward composing traits together through “inheriting”. This is a totally normal thing to do in C++, and the syntax even looks the same, but combining traits in this way to build godlike trait objects does not lead to happy times. There is lots of documentation around explaining that trait inheritance is different in Rust and that you should not use it in this way, but less on how to build abstractions for your application correctly in spite of this.

Restating the given advice in another way, it says to use “generic objects which provide a trait impl” instead of “trait objects”. Then there is no need to make the traits object-safe at all, which is great because requiring it could get in the way of providing the ideal interface, such as preventing the use of generics within the interface. Not that you'd put generics in a C++ abstraction, since you can't combine generics and virtual in C++, so this doesn't seem like a problem worth worrying about to the new Rust developer.

It *is* helpful advice to Rust devs that functions should receive abstractions as generics instead of as trait objects. But it’s missing the underlying intention of *why* a trait object seemed like the better fit. There’s two main reasons that come to mind:

## Testing

It is standard practice in large C++ codebases, take Chromium and Blink for example, to build virtual abstractions around pieces of production code and then replace the implementation with something else when running tests. This is especially true for integration tests, but it is a mechanism used exhaustively (almost certainly over-used) for unit tests as well. I don’t think advice that handwaves at how generics make mocking harder are doing service to this intent.

Blink’s WebTest harness is a good example of this type of system. The production code provides all kind of functionality to Blink, but in tests various things are stubbed out and replaced in order to control inputs that would normally be coming from devices, or the user, or the network. This is foundational for being able to reliably test the Blink implementation of the web platform.

With generics, it is still possible to write tests for functions which make use of an abstraction in isolation, but you can no longer write a factory that returns an implementation of some abstract behaviour, and replace the whole implementation in tests. So writing integration tests of a large system appears impossible without trait objects, unless... the *entire codebase* is parameterized over a set of generic traits. There may be a single production implementation of all those traits, maybe even a single type/object which implements all those traits. Teams can freely write traits and implementations for those traits in their own modules. And when building for tests, a different type may be selected *at compile time*, which comes with different implementations.

If this should be a blessed design pattern, Rust education needs to lean into it when teaching developers about abstractions in Rust. Current education seems heavily skewed toward authoring libraries. And while you can think of an application as a collection of libraries, it is also meaningfully different in how it all comes together as one huge unit, and how concepts may have to span across many parts of a codebase, and be implemented by many teams. It should be expected that a large application comes with a need to provide abstractions that differ in testing. And thus it would be expected up front that most of your application, at least the core glue of the application, is parameterized over generics.

This is not at all how you would write C++ or Java, so it will not be obvious to new Rust application developers.

## Heterogenous collections

Applications are full of collections of heterogenous objects. We use dependency injection and type erasure to build collections of these objects. For instance, lists of callback/task objects or collections of modules that are written by many teams, and are built on top of your core system but are decoupled from it and which you cannot name. Abstractions are used to provide this decoupling, and in Rust you quickly land on collections of trait objects to make things compile, since `Box<dyn T>` is a consistent size. This feels familiar and consistent with a `std::vector<std::unique_ptr<VirtualClass>>` in C++. Except the latter works well in the language (while causing security bugs, sorry I had to say it) while the former causes a lot of friction for the developer in Rust.

The “write your code with a generic parameter” solution will not suffice here. As soon as a Rust application developer goes from a single generic object to multiple heterogenous ones, the strategy for abstraction breaks down and creates confusion.

There are better (I think? I haven't used these myself) ways to do this heterogeous-type-erasure-with-ownership than trait objects, though they appear to be incredibly complicated to implement. The [Bevy game engine](https://bevyengine.org/) does this in order to build an ECS model.

Here’s some articles about doing type erasure for dependency injection:
- [Dependency Injection in Rust with Type-Maps](https://nickbryan.co.uk/software/using-a-type-map-for-dependency-injection-in-rust/)
- [Dependency Injection like Bevy Engine from Scratch](https://promethia-27.github.io/dependency_injection_like_bevy_from_scratch/introductions.html)

In this case, I think there’s an opportunity in both Rust education and in the language to make this less difficult.