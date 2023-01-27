---
tags:
- C++
---

# Me versus C++ Mutable References.

Me: Let me make a recursive operation. It will recurse through a heterogeneous data structure and
call a function for each `Thing` it finds.

```cpp
struct Q {
    Thing t;
    void for_all_things(sus::fn::FnMut<void(Thing&)>& fn) { fn(t); }
}

struct R {
    Thing t;
    void for_all_things(sus::fn::FnMut<void(Thing&)>& fn) { fn(t); }
}

struct S {
    sus::Vec<Q> qs;
    sus::Vec<R> rs;
    void for_all_things(sus::fn::FnMut<void(Thing&)>& fn) {
        for (Q& r: qs) q.for_all_things(fn);
        for (R& r: rs) r.for_all_things(fn);
    }
};
```

Me: Cool, let's call it!

```cpp
void blast_off(S& s) {
    s.for_all_things([count = 0_i32] (Thing& t) mutable {
        count += 1;
    });
}
```

C++: No. You can't pass an rvalue as a mutable reference.

Me: Right, okay, I guess.

```cpp
struct S {
    sus::Vec<Q> qs;
    sus::Vec<R> rs;
    void for_all_things(sus::fn::FnMut<void(Thing&)>&& fn) {
        for (Q& r: qs) q.for_all_things(fn);
        for (R& r: rs) r.for_all_things(fn);
    }
};
```

C++: No. You have a mutable reference to an rvalue now, so you have to move the reference to continue using it as such.

Me: But I'm not trying to pass ownership, I just want a mutable reference. Move would be misleading to read! Gr.

C++: Tough. It's that or write a template.

Me: Fine. I will make an lvalue for you, for no good reason at all.

```cpp
struct S {
    sus::Vec<Q> qs;
    sus::Vec<R> rs;
    void for_all_things(sus::fn::FnMut<void(Thing&)>& fn) {
        for (Q& r: qs) q.for_all_things(fn);
        for (R& r: rs) r.for_all_things(fn);
    }
};

void blast_off(S& s) {
    auto fn = sus::fn::FnMut<void(Thing&)>([count = 0_i32] (Thing& t) mutable {
        count += 1;
    });
    s.for_all_things(fn);
}
```

Me: But I am also going to blog about it.