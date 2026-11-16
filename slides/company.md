---
theme: default
title: Audio Developer Conference 2026
author: Konrad Glas
colorSchema: dark
transition: none
lineNumbers: false
mdc: true
layout: default
class: co-title-slide
---

<div class="co-title-chrome">
  <img class="co-title-logo" src="/muse-logo-light.png" alt="Muse" />
  <div class="co-title-rule top" />
  <div class="co-title-rule bottom" />
</div>

<h1 class="co-title">Audio Developer<br>Conference 2026</h1>

<div class="co-subheadline">Bristol · Konrad Glas</div>

<img class="co-adc-badge" src="/adc/adc-badge.png" alt="audio.dev conference, Bristol and online 2026">

<!--
Hi everyone. I just came back from Bristol, from the Audio Developer Conference.
I gave a talk there. Today you get the ten minute version. And there will be breakfast.
-->

---

# ADC Bristol 2026

<div class="co-gallery">
  <img src="/adc/gathering-1.jpg" alt="People chatting at a demo booth">
  <img src="/adc/gathering-2.jpg" alt="Attendees playing a keyboard at a poster demo">
  <figure class="co-named">
    <img src="/adc/scheps.jpg" alt="Andrew Scheps on stage">
  </figure>
</div>

<div class="co-qualities co-facts">
  <span>Bristol &amp; online</span>
  <span>9–11 Nov</span>
  <span>75+ talks &amp; workshops</span>
  <span>a few hundred audio devs</span>
</div>

<div class="co-credit">Photos: ADC</div>

<!-- TODO: add the emoji metacompiler repo link once found -->

<!--
ADC is the Audio Developer Conference. Every November in Bristol, and online.
Three days. More than seventy-five talks and workshops. A few hundred audio developers.
And it's very much about the people. Demos at the booths, people playing keyboards in the hallway.
And some celebrities, too. That's Andrew Scheps. Grammy-winning mix engineer. He talked about acoustic spaces.

[click]
My favourite moment was the open mic round. Someone presented an emoji metacompiler.
(tell it your way, beat, move on)
-->

---

<div class="co-talks">
  <figure v-click="1" class="co-talk">
    <img src="/adc/audio-clanking.jpg" alt="Julian Storer on stage">
    <figcaption>
      <span class="co-talk-kind">Philosophical</span>
      <strong>Goodbye Audio Crafting.. Hello Audio Clanking</strong>
      <span>Julian Storer</span>
    </figcaption>
  </figure>
  <figure v-click="2" class="co-talk">
    <img src="/adc/graph-to-groove.jpg" alt="Gerald Golka on stage">
    <figcaption>
      <span class="co-talk-kind">Heavy C++</span>
      <strong>From Graph to Groove</strong>
      <span>Gerald Golka</span>
    </figcaption>
  </figure>
  <figure v-click="3" class="co-talk">
    <img src="/adc/raytracing.jpg" alt="Anton Lundberg presenting a GPU and CPU architecture">
    <figcaption>
      <span class="co-talk-kind">Unexpected</span>
      <strong>Real-Time Raytraced Acoustics</strong>
      <span>Anton Lundberg</span>
    </figcaption>
  </figure>
</div>

<div class="co-credit">Photos: ADC</div>

<!--
Just three talks, very quickly. To give you an idea of the range.

[click]
Philosophical. Julian Storer. He wrote JUCE, the framework a big part of the audio industry builds on.
His talk: what AI coding agents change for us. What we still need to know ourselves. Keep that one in mind, it comes back later.

[click]
Heavy C++. Gerald Golka. He works with us at Muse. He built the current musescore.com transcriber.
His talk: a compiler for DSP graphs that runs entirely at compile time. constexpr. Yes, really.

[click]
And one of my favourites. Something I did not expect: raytracing, from a game engine. Anton Lundberg.
Shoot rays through the game level on the GPU, and the reverb comes out of the geometry. Sound designers just assign materials.
-->

---

# Breakfast at the hotel

<div class="co-breakfast" :class="{ 'is-queue': $clicks >= 1, 'is-unpaid': $clicks >= 2, 'is-waiting': $clicks >= 3 }">
  <img class="co-photo" src="/full-english.jpg" alt="A full English breakfast">
  <div v-click="1" class="co-queue">
    <div class="co-host"><span class="co-emoji">🛎️</span><span class="co-label">Host</span></div>
    <div class="co-person co-unpaid"><span class="co-emoji">🧍</span><span v-click="2" class="co-tag">not paid</span></div>
    <div class="co-person"><span class="co-emoji">🧍‍♀️</span></div>
    <div class="co-person"><span class="co-emoji">🧍‍♂️</span></div>
    <div class="co-person"><span class="co-emoji">🧍</span></div>
    <div class="co-person co-me"><span v-click="3" class="co-wait">⏳</span><span v-click="4" class="co-dream">💭</span><span class="co-emoji">{{ $clicks >= 3 ? '😩' : '😋' }}</span><span class="co-label">me</span></div>
  </div>
</div>

<!--
My talk was on Tuesday. But before that, I needed breakfast. A big one. A full English. And I was hungry.

[click]
But first you had to queue. There was a host at the entrance who seated everyone. Normally that takes two seconds per guest.

[click]
But once in a while, someone hadn't paid in advance. So the host took the payment. Right there, at the desk.

[click]
And everybody waited. Including me. Starving.

[click]
And while I'm standing there, starving, I start daydreaming. About code.
Because our apps have exactly that host. We call it the main thread.
-->

---
class: co-daydream
---

# Let's seat a guest!

<div class="co-plan-pair">
<div>

<div class="dense-code co-plan-lines">

```text
 
check room number
has to pay?
take credit card
MAKE SURE TO give it back in the end
 
 
 
charge it
declined? goodbye
 
 
 
assign table
bring coffee
 
```

</div>

</div>
<div v-click="1" class="dense-code">

```cpp
void seatGuest(Guest guest) {
    auto room = host.checkRoomNumber(guest);
    if (room.hasToPayForBreakfast) {
        auto card = terminal.insert(guest.creditCard);
        DEFER {
            terminal.eject(card);
        };

        auto payment = charge(card);
        if (payment.declined)
            return;
    }

    tables.assign(guest);
    waiter.bringCoffee(guest);
}
```

</div>
</div>

<div v-click="2" class="takeaway">Correct. Sequential. Scope-bound. And running entirely on main. 👍</div>

<!--
So I'm standing there, daydreaming. What does the host actually have to do?
Check the room number. Has to pay? The card goes into the machine. And it has to come back out, whatever happens. Charge it. Declined? Goodbye. Otherwise: a table, and coffee.

[click]
And here's the same list in C++. In my ADC talk, this code loaded a preset in a sample player. Today it seats a guest.
Line by line, it's the list. The DEFER right after the card goes in: whatever happens next, the card comes back out. That's the "make sure to".
If you don't read C++: just read it top to bottom next to the list. That's exactly what it does.

[click]
And it's correct. But all of it runs on Main. On the host.
-->

---
class: co-daydream
---

# The manager

<div class="chat-stack">
  <ChatMessage v-click from="Manager">The queue goes all the way to the lobby!</ChatMessage>
  <ChatMessage v-click from="Developer">Hm OK ...  Don't worry ...</ChatMessage>
  <ChatMessage v-click from="Developer">I'll fix it.</ChatMessage>
</div>

<!--
This ran fine for years. Then more and more guests had to pay.

[click]
And one day the manager says: the queue goes all the way to the lobby!
That's charge. The terminal talks to the bank. Slow. And the host just stands there, waiting.
In software, that queue is the spinning wheel of death.

[click]
Hm, OK. Don't worry.

[click]
I'll fix it. (beat)
-->

---
class: co-daydream
---

# Easy: self-service!

<div class="co-plan-pair">
<div>

<div class="co-plan" :class="{ 'show-terminal': $clicks >= 1 }">
  <div>check room number</div>
  <div>has to pay?</div>
  <div class="co-plan-terminal">
    <span class="co-plan-tag">💳 card terminal</span>
    <div>take credit card</div>
    <div>MAKE SURE TO give it back in the end</div>
    <div>charge it</div>
    <div>declined? goodbye</div>
  </div>
  <div>assign table</div>
  <div>bring coffee</div>
</div>

</div>
<div v-click="2" class="dense-code">

```cpp
auto card = terminal.insert(guest.creditCard);
chargeAsync(card, [&](auto payment) {
    if (payment.declined)
        return;

    terminal.eject(card);
    host.post([&] {
        tables.assign(guest);
        waiter.bringCoffee(guest);
    });
});
```

</div>
</div>

<span v-click="1" style="display: none"></span>

<div v-click="3" class="takeaway">Non-blocking. Back on main. Ship it 🚢</div>

<!--
Easy. Self-service.

[click]
That part goes to the card terminal. The guest pays at the machine. The host is free right away, and seats the next guest.
A machine can charge a card. It can't seat you. So afterwards, you come back to the host.

[click]
In code: card in, charge it, and give it a callback for when the bank answers.
No DEFER this time: it would fire as soon as this function returns. Way before the bank answers. So I eject by hand, in the callback.
Then post back to the host. Table, coffee. On Main.
(don't linger on the return)

[click]
Non-blocking. Back on Main. Ship it!
-->

---
class: co-daydream
---

# The manager tests it

<div class="bug-pair dense-code co-eaten">
<div>

```cpp {hide|hide|hide|none|3-4}
auto card = terminal.insert(guest.creditCard);
chargeAsync(card, [&](auto payment) {
    if (payment.declined)
        return;

    terminal.eject(card);
    host.post([&] {
        tables.assign(guest);
        waiter.bringCoffee(guest);
    });
});
```

</div>
<div class="bug-report co-eaten-bug">
  <div v-click="4" class="bug-link" aria-hidden="true">
    <span class="bug-arrow">←</span>
    <span class="bug-icon">🐛</span>
  </div>
  <div class="chat-stack" style="margin: 0">
    <ChatMessage v-click="1" from="Developer">Fixed. Try it now.</ChatMessage>
    <ChatMessage v-click="2" from="Manager">When a card is declined, the machine eats it!</ChatMessage>
  </div>
</div>
</div>

<!--
(confident)

[click]
Fixed. Try it now.

[click]
When a card is declined, the machine eats it! (let it land)

[click]
What did I do? (beat)

[click]
There. Declined: I return. And nobody ejects the card. That was the "make sure to". And I forgot.
-->

---
class: co-daydream
---

<div class="code-compare dense-code coroutine-compare">
<div>

<div class="eyebrow">Previous synchronous version</div>

```cpp
void seatGuest(Guest guest) {
    auto room = host.checkRoomNumber(guest);
    if (room.hasToPayForBreakfast) {
        auto card = terminal.insert(guest.creditCard);
        DEFER {
            terminal.eject(card);
        };
        auto payment = charge(card);
        if (payment.declined)
            return;
    }
    tables.assign(guest);
    waiter.bringCoffee(guest);
}
```

</div>
<div v-click="1">

<div class="eyebrow">{{ $clicks < 3 ? 'Non-blocking version' : 'Coroutine' }}</div>

<div v-if="$clicks < 2">

```cpp
void seatGuest(Guest guest) {
    auto room = host.checkRoomNumber(guest);
    if (!room.hasToPayForBreakfast) {
        tables.assign(guest);
        waiter.bringCoffee(guest);
        return;
    }
    auto card = terminal.insert(guest.creditCard);
    chargeAsync(card, [&, guest, card](auto payment) {
        terminal.eject(card);
        if (payment.declined)
            return;
        host.post([&, guest] {
            tables.assign(guest);
            waiter.bringCoffee(guest);
        });
    });
}
```

</div>
<div v-else>

```cpp
stdexec::task<void> seatGuest(Guest guest) {
    auto room = host.checkRoomNumber(guest);
    if (room.hasToPayForBreakfast) {
        auto card = terminal.insert(guest.creditCard);
        DEFER {
            terminal.eject(card);
        };
        auto payment = co_await stdexec::starts_on(terminal, charge(card));
        if (payment.declined)
            co_return;
    }
    tables.assign(guest);
    waiter.bringCoffee(guest);
}
```

</div>

</div>
</div>

<span v-click="2" style="display: none"></span>
<span v-click="3" style="display: none"></span>

<!--
Okay. Deep breath. Here's the plain version from the start. Correct. But blocking.

[click]
And here's the callback version. Fixed this time: the card always comes out. So it's correct.
But look at it. The if got turned inside out. Table and coffee are written twice. And the card comes out by hand.

[click]
So what if we kept the shape on the left? Same order. But without blocking.

[click]
That's a coroutine. It reads like the left side. It just says co_await where it waits.
-->

---
class: co-daydream
---

# Yes! This is actually nice.

<div class="structured-celebration-code">

```cpp
stdexec::task<void> seatGuest(Guest guest) {
    auto room = host.checkRoomNumber(guest);
    if (room.hasToPayForBreakfast) {
        auto card = terminal.insert(guest.creditCard);
        DEFER { terminal.eject(card); };

        auto payment = co_await stdexec::starts_on(terminal, charge(card));
        if (payment.declined)
            co_return;
    }

    tables.assign(guest);
    waiter.bringCoffee(guest);
}
```

</div>

<div v-click="1" class="structured-win-grid">
  <div><strong>Sequential</strong></div>
  <div><strong>RAII</strong></div>
  <div><strong>Main-affine</strong></div>
  <div><strong>Structured</strong></div>
</div>

<!--
Let's put it together. The DEFER is back, right where the card goes in. Declined? co_return. And the card still comes out. The machine never eats it.

[click]
Sequential: it runs in the order you read it.
RAII: the DEFER runs on every path. No line to forget.
Main-affine: every line that touches the seating plan runs with the host. So no locks.
Structured: nothing escapes, nothing is left dangling.
-->

---

<div class="co-photo-overlay">
  <img src="/full-english.jpg" alt="A full English breakfast">
</div>

<!--
And then, finally, my turn. Breakfast.
-->

---

<div class="co-photo-overlay">
  <img src="/adc/konrad-talk.jpg" alt="Konrad giving his talk at ADC">
</div>

<div class="co-credit co-credit-overlay">Photo: ADC</div>

<!--
Full and happy, I gave my talk. On Tuesday.
-->

---

# What I built on

<div class="stdexec-choice-layout stdexec-stack-only">
<div class="stdexec-stack">
  <div v-click="2" class="stdexec-layer affine-layer"><strong><code>affine</code> · mine</strong><span>scheduler for the main loop</span></div>
  <div v-click="1" class="stdexec-layer coroutine-layer"><strong><code>stdexec::task</code></strong><span>back to the same scheduler · built in</span></div>
  <div v-click="1" class="stdexec-layer sender-layer"><strong><code>stdexec</code></strong><span>reference implementation of C++26 <code>std::execution</code></span></div>
</div>
</div>

<!--
In the talk, I also showed what's underneath. A quick word for the developers.

[click]
The base is stdexec. That's the reference implementation of std::execution, which is new in C++26. That was my reference for everything.
And stdexec::task is the coroutine type. And it already comes back to the scheduler it started on. "Back to the same host" comes for free.

[click]
What I added is a small library on top. I call it affine. A scheduler for the main loop of a plugin or an app.
-->

---

# About readability

<div class="code-compare readability-compare">
<div>

```cpp
void seatGuest(Guest guest) {
    auto room = host.checkRoomNumber(guest);
    if (!room.hasToPayForBreakfast) {
        tables.assign(guest);
        waiter.bringCoffee(guest);
        return;
    }
    auto card = terminal.insert(guest.creditCard);
    chargeAsync(card, [&, guest, card](auto payment) {
        terminal.eject(card);
        if (payment.declined)
            return;
        host.post([&, guest] {
            tables.assign(guest);
            waiter.bringCoffee(guest);
        });
    });
}
```

<div class="readability-verdicts">
  <span v-click="1" class="ok">✓ works</span>
  <span v-click="2" class="hard">hard to verify</span>
</div>

</div>
<div>

```cpp
stdexec::task<void> seatGuest(Guest guest) {
    auto room = host.checkRoomNumber(guest);
    if (room.hasToPayForBreakfast) {
        auto card = terminal.insert(guest.creditCard);
        DEFER { terminal.eject(card); };

        auto payment = co_await stdexec::starts_on(terminal,
            charge(card));
        if (payment.declined)
            co_return;
    }

    tables.assign(guest);
    waiter.bringCoffee(guest);
}
```

<div class="readability-verdicts">
  <span v-click="1" class="ok">✓ works</span>
  <span v-click="2" class="ok">reads like the intent</span>
</div>

</div>
</div>

<!--
One more thing: readability.
Remember Julian's talk about agents? More and more of our code, we didn't type ourselves. But we still have to understand it.

[click]
An agent can write the left one. Even bug-free. Both of these work.

[click]
But try to check the left one. Does every card come back out of the machine? You have to follow every callback to find out.
On the right, you read it top to bottom and you can check it. That's good for us. And it's good for the agents too.
-->

---

# Where we could use it

<div class="co-uses">
  <div><h3>Engraving</h3></div>
  <div><h3>Networking</h3></div>
  <div><h3>Anywhere in C++</h3></div>
</div>

<div v-click="1" class="co-qualities">
  <span>Non-blocking</span>
  <span>User-friendly</span>
  <span>Thread-safe</span>
  <span>Easier to write</span>
</div>

<!--
So where could we use this? Basically anywhere we write C++ and have a host at the desk.
Engraving. Networking. Our players and plugins. Anything that waits for something and shouldn't freeze the app.
(add one concrete example here if you have one)

[click]
Code that doesn't block. That keeps the app responsive for the user. That's thread-safe without locks.
And code that's easier to write. And to read.
-->

---

# Questions?

<div class="code-compare">
<div>

```cpp
stdexec::task<void> seatGuest(Guest guest) {
    auto room = host.checkRoomNumber(guest);
    if (room.hasToPayForBreakfast) {
        auto card = terminal.insert(guest.creditCard);
        DEFER { terminal.eject(card); };

        auto payment = co_await stdexec::starts_on(terminal,
            charge(card));
        if (payment.declined)
            co_return;
    }

    tables.assign(guest);
    waiter.bringCoffee(guest);
}
```

</div>
<div>

<div class="eyebrow">GitHub</div>

- [konradglas/adc-coroutines-demo](https://github.com/konradglas/adc-coroutines-demo)
- [konradglas/stdexec-affine](https://github.com/konradglas/stdexec-affine)
- [NVIDIA/stdexec](https://github.com/NVIDIA/stdexec)

<div class="qr-card">
  <img src="/qr-stdexec-affine.svg" alt="QR code: github.com/konradglas/stdexec-affine">
  <span>stdexec-affine</span>
</div>

</div>
</div>

<!--
This is the function we started with. Same order. The card comes out in one place. But the host never blocks.
The repo has the real version, with presets instead of card terminals.
A few people at ADC told me they'd have a look at it. You're welcome to as well.
Thank you! Questions?
-->
