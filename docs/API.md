# Robot Lab — Student Python API (source of truth)

The runtime (`src/runtime`) implements exactly this. The blocks generator (`src/blocks`) emits only this.
It is a superset of the original Grid Robot Sim API, so every old program still runs unchanged.
Names follow VEX-style Python so students can move to real robots later.

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
