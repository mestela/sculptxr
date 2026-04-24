problem okay so we we've done a kind of tour of some of the issues that we
34:35
had doing this demo right but we're all here not because we're demo programmers I guess well most of of us aren't but we
34:42
don't work on 7 MHz machines we have more than one mega ram what are the lessons and how do we um take it to our
34:51
day-to-day so one thing I want to talk about is this idea of back pressure which is a a fancy way of
34:58
saying that resources are finite and you don't have infinite memory think about it this way a system
35:04
is always Bound by the slowest component right that's going to hold up your throughput whatever it
35:11
is if it can't keep up you have to stall or fail people who are trying to put more work on
35:19
it consider this like consumer producer type problem like with thread pooling or
35:25
work cues or whatever if you're producing more stuff than your consumer
35:30
can eat what are you going to do with it and here's you know speaking of why
35:36
we need this conference if you look at a lot of libraries that try to do this they just buffer it on the Heap and
35:42
return great like who what so there's no back pressure and after a while you run
35:49
out of memory won't work you know and if you look and squint you see this problem everywhere whether
35:55
it's work items in a queue or buffer or ring buffers or temp file space for that
36:00
matter or logging right it's important to find a way to
36:06
solve this problem in system design right what happens when I can't keep
36:11
up and a lot of times people just YOLO this so uh and let me tell you having
36:18
something very very slow makes this really evident when you've screwed it up so you know maybe consider using an
36:25
Amiga finding or inventing constraints is
36:30
another thing I think we should do day-to-day a constraint is what allows you to explore a problem end to end if
36:37
you can't say what the maximum count is you have no idea you don't know what problem
36:43
you're solving the good news is you you know
36:48
you you can make a constraint which is in fact okay right and you can make it hard or
36:55
soft whatever as applicable but it's a a Fool's errand to say well I
37:00
I'm not ready to commit I'm just going to dynamically grow right then you have in fact not solve the
37:07
problem so take something like I'm going to have 10 24 Dynamic actors
37:13
Max okay that might seem silly like why would you draw a hard line there like what about 2,000 wouldn't that be cool
37:20
well it might be but then you could raise the limit and do the appropriate tradeoffs but if you know what the
37:26
bounds are you can now reason about what the worst case is for updating for sorting for memory allocation
37:35
right similarly it let's say you need to run at 120 FPS great work backwards
37:42
again you have an 8 millisecond frame you can start informing other constraints on here's how much time I
37:48
can spend on my actor update or whatever it is uh we looked at emulation and
37:54
Playback a little bit right by capturing input to a system so you can replay them
38:00
you can emulate the real world as it were right and put something in a test
38:06
bench the thing about this is that it sort of makes you independent from real-time constraints right I'm sure a
38:13
lot of you work with network stuff or with sort of real-time event stuff put all that [ __ ] in a file and fake it
38:20
happening it won't be exactly what's happening in real time but it'll be good
38:25
enough and close enough that you can res about what the bounds are what the performance numbers are how you can profile it what the worst cases are um
38:33
so something I did work recently where the group um took a build system that took eight hours to complete something
38:41
but 7 hours and 50 minutes of that were something else so we faked all of that like just
38:48
pretend it all just happened so we could profile what was left which was the interesting
38:54
part another example is race condition Discovery you see some tools doing this where you're fussing sort of multiple
39:00
threads by simulating what order you're stepping them in and finding race conditions
39:06
automatically this is impossible to do if you're relying on time and luck right
39:11
you need a way to rip it away from that time axis and put it in a test
39:17
bench uh this might be a new point for you don't do it at runtime which you've seen a lot of lot of time a lot of times
39:24
in this talk this goes back to what we talking about earlier that it's it seems
39:30
like a curse that we're expected to just live with shitty stuff and when we look at software it's
39:38
like yeah it's slow takes 10 minutes to run an update on Firefox or whatever death by Thousand Cuts is a thing right
39:45
and we sort of as programmers find ourselves in a position where we have to be vigilant in code reviews like there's
39:52
a better way to do that right or don't waste time or don't do the thing
39:57
and as computers get faster you can get away with this 7 MHz you can't so here's some
40:05
examples that we can take to to hard for today right maybe you're comparing strings at run time like maybe just hash
40:13
those string constants instead of build time and put the hashes in and compare those or you know stuff like that or
40:21
saying ah I can't commit to what's going to be in this thing so we're going to allocate it out of a million small pieces
40:27
but we could compute the worst case and allocate
40:33
that um so some of you will say like well that doesn't apply to me because I have this like Dynamic game and I need
40:39
to tweak everything and like screw you in your static offline stuff right because then I can't tweak
40:47
things to which I say false what whatever you use to produce
40:53
the data that you loaded to do the TBL driven small thing do it again and then reload the
41:00
table problem solved uh and you know what what else is cool about this like
41:06
uh you don't have to put a bunch of tweak junk in your app or game like that code doesn't need to exist anymore you
41:13
don't have to link in shitty I gooey libraries and like have your designers edit [ __ ] inside a game when they'd
41:19
rather be spending time in Excel or a text edit or whatever um and you don't have to support it so that seems like a
41:26
win to me all right let's wrap up here uh obviously there's way way more to make
41:33
in this demo than what I've covered here this was kind of a really quick um intro
41:39
for non demo seeners it's a lot of fun if you want to
41:45
try something like this go for it just be aware that the barrier of Entry is crazy
41:51
high some of the more uh slient points remember to work backwards to to uncover
41:58
constraints adopt those constraints to make decisions don't
42:04
overgeneralize do the slow thing offline and do the fast thing