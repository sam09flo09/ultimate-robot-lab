# Robot Lab — Student Python API (source of truth)

The runtime (`src/runtime`) implements exactly this. The blocks generator (`src/blocks`) emits only this.
It is a superset of the original Grid Robot Sim API, so every old program still runs unchanged.
Names follow common classroom-robot Python conventions (drivetrain, direction and unit constants).

## Program shape
```python
def main():
    drivetrain.drive_for(FORWARD, 200, MM)

start(main)          # required last line, not indented
```
`start(fn)` runs `fn()`. If `start` is never called, the app shows an info message (same as today).

## Constants (all are plain strings equal to their own name)
FORWARD REVERSE LEFT RIGHT · MM INCHES DEGREES SECONDS MSEC PERCENT ·
RED GREEN BLUE YELLOW ORANGE PURPLE WHITE BLACK NONE · UP DOWN · BOOST DROP

## drivetrain
| call | behaviour |
|---|---|
| `drive_for(dir, distance, units, wait=True)` | dir FORWARD/REVERSE, units MM/INCHES. `wait=False` starts it and returns immediately. Negative distance flips direction. |
| `turn_for(dir, angle, units, wait=True)` | dir LEFT/RIGHT, units DEGREES. |
| `turn_to_heading(angle, units, wait=True)` | shortest turn to absolute gyro heading. |
| `drive(dir)` | start driving until `stop()` or another motion command. |
| `turn(dir)` | start turning until `stop()`. |
| `stop()` | stop all motion. |
| `set_drive_velocity(v, PERCENT)` / `set_turn_velocity(v, PERCENT)` | 1..100, default 50. |
| `set_heading(angle, DEGREES)` | re-zero the gyro. |
| `heading(DEGREES)` → float [0,360) | `rotation(DEGREES)` → float unbounded |
| `is_done()` → bool | true when no motion in progress |

## Sensors
| object.call | returns |
|---|---|
| `distance.get_distance(MM)` (or INCHES) | number; 3000 mm if nothing in range |
| `distance.found_object()` | bool, something within 1000 mm |
| `front_eye.near_object()` | bool, object within 100 mm ahead |
| `front_eye.detect(COLOR)` | bool |
| `front_eye.color()` | colour constant string, e.g. `RED` (compare with `==`) |
| `front_eye.brightness(PERCENT)` | 0..100 |
| `down_eye.detect(COLOR)` / `down_eye.color()` / `down_eye.brightness(PERCENT)` | floor under robot |
| `bumper.pressed()` | bool |
| `location.position(X, MM)` / `location.position(Y, MM)` | number (X and Y are also constants) |

## Hardware (only in worlds that fit it; otherwise a friendly error says "this playground has no pen")
| call | behaviour |
|---|---|
| `pen.move(DOWN)` / `pen.move(UP)` | start / stop drawing |
| `pen.set_pen_color(COLOR)` | |
| `magnet.energize(BOOST)` | pick up the object directly in front (within 100 mm) |
| `magnet.energize(DROP)` | drop it |

## Arm and claw (only in worlds with `hardware.arm`, e.g. Stack Shop)
A 1-DOF lifting arm with a claw on the end. The claw sits about 60 mm in front of the robot's front
face (it grabs things up to 110 mm ahead, within 40 mm either side of centre). The arm angle goes from
0° (down: claw at the floor) to 90° (straight up); the claw height is `300 × sin(angle)` mm. Without an
arm every call below gives a friendly RuntimeError: "This playground has no arm…".

```python
def main():
    claw.close()                              # grab the block in front
    arm.spin_to_position(30, DEGREES)         # lift it 150 mm
    drivetrain.drive_for(FORWARD, 400, MM)
    arm.spin_to_position(0, DEGREES)          # lower until it sits on the platform
    claw.open()                               # let go

start(main)
```

| call | behaviour |
|---|---|
| `arm.spin_to_position(angle, DEGREES, wait=True)` | move to 0..90 (outside values are clamped, with a warning); waits until there. Stops early (and returns) if the claw — or what it holds — lands on something: a platform top or a stack |
| `arm.spin(UP)` / `arm.spin(DOWN)` | keep moving until `arm.stop()` (stops by itself at 0 and 90, or when blocked) |
| `arm.stop()` | stop the arm |
| `arm.set_velocity(v, PERCENT)` | 1..100, default 50 = 60°/s (100% = 120°/s) |
| `arm.position(DEGREES)` | current angle, float |
| `claw.close()` (alias `claw.grab()`) | close (~0.3 s). Grabs a pickable object whose centre is in the claw zone and whose height overlaps the jaws (from the claw height up to 40 mm above it). Objects stacked on it come along |
| `claw.open()` (alias `claw.release()`) | open (~0.3 s) and let go: the object rests on the highest platform or object top under its centre that isn't above its bottom, otherwise it drops to the floor |
| `claw.is_holding()` | True while the claw holds something |

Objects up on a platform or a stack (and the one in the claw) don't collide with the robot body or with
floor objects; platforms are solid like walls. Magnet and claw are independent and can both be fitted.

## Brain
| call | behaviour |
|---|---|
| `brain.screen.print(value, ...)` | text on the robot screen panel |
| `brain.screen.new_line()` / `brain.screen.clear_screen()` | |
| `brain.timer.time(SECONDS)` (or MSEC) / `brain.timer.clear()` | sim time |
| `wait(t, SECONDS)` or `wait(t, MSEC)` | units default SECONDS |
| `print(...)` | goes to the step log (as today) |

## Standard Python
`math` and `random` imports work. `while True:` loops must not freeze the page (Skulpt yields + Stop works).
Errors are explained in student-friendly language, as in the original sim (see `friendly()` in the original file).

## Constant: X, Y
Added to the constants list for `location.position`.

## Driver control: controller and motors
Students write a loop that reads the controller and sets the motors. Driver programs run at 1× speed
(a person is driving in real time). Inputs come from the keyboard, an on-screen controller (touch
Chromebooks) or a USB/Bluetooth gamepad — whichever the student uses.

```python
def main():
    while True:
        left_motor.spin(FORWARD, controller.axis3.position(), PERCENT)
        right_motor.spin(FORWARD, controller.axis2.position(), PERCENT)
        if controller.buttonA.pressing():
            magnet.energize(BOOST)
        wait(20, MSEC)

start(main)
```

| call | returns / behaviour |
|---|---|
| `controller.axis1.position()` … `axis4` | -100..100. axis1 = right stick left/right, axis2 = right stick up/down, axis3 = left stick up/down, axis4 = left stick left/right. Up and right are positive. |
| `controller.buttonA.pressing()` (also `buttonB`, `buttonX`, `buttonY`, `buttonUp`, `buttonDown`, `buttonLeft`, `buttonRight`, `buttonL1`, `buttonL2`, `buttonR1`, `buttonR2`) | True while held |
| `left_motor.spin(dir, velocity, PERCENT)` / `right_motor.spin(...)` | dir FORWARD/REVERSE; velocity -100..100 (negative = backwards); keeps spinning until changed or stopped |
| `left_motor.stop()` / `right_motor.stop()` | that wheel stops |
| `left_motor.set_velocity(v, PERCENT)` + `left_motor.spin(FORWARD)` | velocity can also be set first, VEX-style; default 50 |
| `left_motor.velocity(PERCENT)` | the velocity it was last told |

Motor commands and drivetrain commands share the same wheels: a `drivetrain.drive_for(...)` stops any
motor spin first, and `motor.spin` cancels an unfinished `drive(...)`/`turn(...)`.

### Keyboard layout (shown on screen)
| control | keys |
|---|---|
| left stick (axis3 up/down, axis4 left/right) | W / S, A / D |
| right stick (axis2 up/down, axis1 left/right) | ↑ / ↓, ← / → |
| buttons X, Y, A, B | I, J, L, K |
| L1 / L2, R1 / R2 | Q / Z, E / C |
| Up / Down / Left / Right buttons | T / G / F / H |

## Robot builder (🔧 Robot)

Students design their robot in the Robot Builder; the design (`RobotConfig`) is saved in the project
(`.robolab` → `robot`). The commands don't change — the same program drives differently:

| Part | Choices | What it does |
|---|---|---|
| Size | 120–200 mm (standard 140) | Collision box. Fits through gaps ≥ size + ~10 mm. Wheels are size − 20 mm apart, so bigger robots turn slower. |
| Wheels | 60, 80, 100 (standard), 130 mm | Bigger wheels go further per turn: faster, but weaker. |
| Gear ratio | 3:1, 2:1, 1:1 (standard), 1:2, 1:3 | 3:1 = wheels turn 3× slower but push 3× harder (low gear on a bike). 1:3 = 3× faster, 3× weaker. |
| Motors | 2 (standard) or 4 | 4 motors push twice as hard; top speed is the same. |
| Sensor position | along the front edge | Moves the distance sensor and front eye left/right. |

The formulas (100% velocity):

- **Top speed** = 800 mm/s × (wheel ÷ 100) ÷ gear ratio
- **Turn speed** = 360 °/s × (wheel ÷ 100) ÷ gear ratio × 120 ÷ (size − 20)
- **Push strength** = (motors ÷ 2) × gear ratio × (100 ÷ wheel) — the standard robot is 1.

Every object has a **mass** (default 1). If mass > push strength the robot stalls against it like a wall:
`drive_for` ends early, the bumper is pressed, but it is not counted as a wall hit (the wheels spin).
`drive_for` distances and `turn_for` angles stay exact — only how long they take changes.
Level makers can set an object's mass (0.5–4) and **Robot rules**: lock the robot (everyone uses the
standard robot, e.g. for fair races) or cap its size. Race best times are kept per robot design.
