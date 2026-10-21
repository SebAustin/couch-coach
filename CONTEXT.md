# Couch Coach

A living-room fitness coach: a phone watches a person exercise, a Fire TV shows their movement and progress, and an AI coach that remembers each member of the household gives spoken feedback.

## People

**Household**:
The group of people who share one TV and its Couch Coach install.
_Avoid_: Account, family, tenant

**Member**:
One person in a Household, identified by display name, whose history and goals the Coach remembers.
_Avoid_: User, profile, player, athlete

## Pairing

**Session**:
One pairing of a TV and a phone for a single Member, from scanning the Pairing Code to the Recap.
_Avoid_: Connection, room, game

**Pairing Code**:
The short-lived credential shown as a QR code on the TV that lets exactly one phone join a Session.
_Avoid_: PIN, invite, link

**Camera Phone**:
The phone that joined a Session; it watches the Member and doubles as a remote.
_Avoid_: Client, controller, mobile

## Movement

**Pose**:
The 33 body landmarks detected in one camera frame.
_Avoid_: Skeleton (that is only the drawing of a Pose), keypoints frame

**Exercise**:
A kind of movement Couch Coach can count, e.g. squat, jumping jack, lunge.
_Avoid_: Move, activity, drill

**Rep**:
One complete cycle of an Exercise; it counts even if it has Faults.
_Avoid_: Count, repetition (in code)

**Fault**:
A named, weighted form mistake detected during a Rep (e.g. shallow depth, knees caving).
_Avoid_: Error, warning, issue

**Form Score**:
100 minus the weights of a Rep's Faults, floored at 0; a Set's Form Score is the mean of its Reps.
_Avoid_: Quality, grade, accuracy

## Training

**Workout**:
An ordered plan of Sets for one Member, proposed and adjusted by the Coach.
_Avoid_: Routine, program, plan (in UI)

**Set**:
A run of Reps of one Exercise, ended by the Member on the Camera Phone or by 8 seconds without movement.
_Avoid_: Round, bout

**Coach**:
The AI persona that reviews each Set, speaks Cues, adjusts the Workout and remembers each Member.
_Avoid_: Agent, bot, assistant (in UI)

**Cue**:
A short spoken and displayed piece of Coach feedback after a Set.
_Avoid_: Tip, message, notification

**Recap**:
The Coach's end-of-Session summary of what the Member did and what changes next time.
_Avoid_: Report, summary screen
