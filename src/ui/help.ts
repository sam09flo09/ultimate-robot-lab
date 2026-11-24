/** Help panel content: a concise command card hand-written from docs/API.md. */

import { keyTableHtml } from "../input/panel"; // controller

const row = (code: string, what: string) => `<tr><td><code>${code}</code></td><td>${what}</td></tr>`;
const table = (rows: string[]) => `<table class="ref-table"><tbody>${rows.join("")}</tbody></table>`;

export const HELP_HTML = `
<section>
  <h3>Program shape</h3>
  <p>Put your statements <b>inside</b> <code>def main():</code>, indented 4 spaces.
  The last line, <code>start(main)</code>, is not indented and starts your program.</p>
<pre>def main():
    drivetrain.drive_for(FORWARD, 200, MM)
    drivetrain.turn_for(RIGHT, 90, DEGREES)

start(main)</pre>
  <p>Capitals matter: <code>FORWARD</code>, <code>RIGHT</code>, <code>MM</code>, <code>DEGREES</code>. Put commas between values.
  A line starting with <code>#</code> is a comment — Python skips it.</p>
  <p>Heading: 0° faces up, 90° faces right (clockwise). On the number grid, <b>1 square = 200 mm</b>.</p>
</section>

<section>
  <h3>Drivetrain</h3>
  ${table([
    row("drivetrain.drive_for(FORWARD, 200, MM)", "drive straight; also <code>REVERSE</code>, <code>INCHES</code>"),
    row("drivetrain.turn_for(RIGHT, 90, DEGREES)", "turn on the spot; also <code>LEFT</code>"),
    row("drivetrain.turn_to_heading(180, DEGREES)", "turn to face a heading"),
    row("..., wait=False", "start the motion and carry straight on"),
    row("drivetrain.drive(FORWARD)", "keep driving until <code>stop()</code>"),
    row("drivetrain.turn(LEFT)", "keep turning until <code>stop()</code>"),
    row("drivetrain.stop()", "stop moving"),
    row("drivetrain.set_drive_velocity(50, PERCENT)", "speed 1–100 (default 50)"),
    row("drivetrain.set_turn_velocity(50, PERCENT)", "turn speed 1–100"),
    row("drivetrain.set_heading(0, DEGREES)", "re-zero the gyro"),
    row("drivetrain.heading(DEGREES)", "current heading, 0–360"),
    row("drivetrain.rotation(DEGREES)", "total turning (can go past 360)"),
    row("drivetrain.is_done()", "<code>True</code> when not moving"),
  ])}
</section>

<section>
  <h3>Sensors</h3>
  ${table([
    row("distance.get_distance(MM)", "distance to what's ahead (3000 if nothing)"),
    row("distance.found_object()", "something within 1000 mm"),
    row("front_eye.near_object()", "object within 100 mm ahead"),
    row("front_eye.detect(RED)", "is the object ahead red?"),
    row("front_eye.color()", "colour ahead, e.g. <code>RED</code>; compare with <code>==</code>"),
    row("front_eye.brightness(PERCENT)", "0–100"),
    row("down_eye.detect(GREEN)", "is the floor under the robot green?"),
    row("down_eye.color() / down_eye.brightness(PERCENT)", "floor colour / brightness"),
    row("bumper.pressed()", "<code>True</code> while touching something"),
    row("location.position(X, MM)", "x position (also <code>Y</code>)"),
  ])}
  <p>Colours: <code>RED GREEN BLUE YELLOW ORANGE PURPLE WHITE BLACK NONE</code></p>
</section>

<section>
  <h3>Pen &amp; magnet <span class="muted">(only in playgrounds that have them)</span></h3>
  ${table([
    row("pen.move(DOWN)", "start drawing; <code>pen.move(UP)</code> stops"),
    row("pen.set_pen_color(BLUE)", "change ink colour"),
    row("magnet.energize(BOOST)", "pick up the object just in front"),
    row("magnet.energize(DROP)", "drop it"),
  ])}
</section>

<section>
  <h3>Brain, waiting and printing</h3>
  ${table([
    row("brain.screen.print(\"Hi\", x)", "show text on the Robot screen tab"),
    row("brain.screen.new_line()", "next line"),
    row("brain.screen.clear_screen()", "clear the screen"),
    row("brain.timer.time(SECONDS)", "time since start (or <code>MSEC</code>)"),
    row("brain.timer.clear()", "restart the timer"),
    row("wait(1, SECONDS)", "pause (or <code>MSEC</code>)"),
    row("print(\"hello\", x)", "write in the Steps log"),
  ])}
  <p><code>import math</code> and <code>import random</code> work. A <code>while True:</code> loop is fine — press Stop to end it.</p>
</section>

<!-- debugger -->
<section>
  <h3>Pause, step and watch variables</h3>
  <p><b>⤵ Step</b> starts your program paused on its first line. Press it again to run one line at a time —
  the blue line is the one that runs next. <b>⏸ Pause</b> stops a running program where it is;
  <b>▶ Continue</b> carries on. The <b>Variables</b> tab shows your variables and their values.</p>
  <p>Typing in Python? After <code>drivetrain.</code> a list of commands pops up — use the arrow keys and Enter.
  Rest the mouse on a command to see what it does.</p>
</section>

<!-- controller -->
<section>
  <h3>Driving with a controller</h3>
  <p>A <b>driver program</b> reads the controller in a loop and sets the motors, so you drive the robot yourself.
  Use the keyboard, a USB or Bluetooth gamepad, or the on-screen controller (🎮 button above the playground).
  Driver programs always run at real speed (1×). The <b>🎮</b> tab on the right shows what your program reads.</p>
  ${table([
    row("controller.axis3.position()", "left stick up/down, -100 to 100 (up is +)"),
    row("controller.axis4.position()", "left stick left/right (right is +)"),
    row("controller.axis2.position() / axis1", "right stick up/down / left/right"),
    row("controller.buttonA.pressing()", "<code>True</code> while held; also B X Y, Up Down Left Right, L1 L2 R1 R2"),
    row("left_motor.spin(FORWARD, 50, PERCENT)", "spin one wheel, -100 to 100; <code>left_motor.stop()</code>"),
  ])}
<pre>def main():
    while True:
        left_motor.spin(FORWARD, controller.axis3.position(), PERCENT)
        right_motor.spin(FORWARD, controller.axis2.position(), PERCENT)
        wait(20, MSEC)

start(main)</pre>
  <p>This is <b>tank drive</b>: W / S drive the left wheel, ↑ / ↓ the right wheel. Click the playground so the keys
  drive (not the code). Press <b>Esc</b> to stop.</p>
  ${keyTableHtml()}
</section>

<!-- builder -->
<section>
  <h3>Robot Builder <span class="muted">(🔧 Robot)</span></h3>
  <p>Design your robot, then press <b>Apply</b>. Your design is saved in your project.</p>
  <ul>
    <li><b>Gear ratio</b>: 3:1 = slow but 3× stronger (low gear on a bike); 1:3 = 3× faster but weaker.</li>
    <li><b>Bigger wheels</b> = faster but weaker. <b>4 motors</b> = twice the push, same speed.</li>
    <li><b>Bigger robot</b> = turns slower and needs wider gaps (size + 10 mm).</li>
    <li>An object heavier than your <b>push strength</b> makes the wheels spin: <code>drive_for</code> stops early and the bumper is pressed.</li>
    <li><code>drive_for</code> distances and <code>turn_for</code> angles stay exact — only how long they take changes.</li>
  </ul>
</section>

<section>
  <h3>Keyboard shortcuts</h3>
  ${table([
    row("Ctrl + Enter", "Run"),
    row("Esc", "Stop"),
    row("F8", "Pause / Continue"),
    row("F10", "Step: run the next line (starts Step through when stopped)"),
    row("Tab / Shift + Tab", "indent / unindent (in the Python editor)"),
    row("Esc, then Tab", "leave the Python editor with the keyboard"),
    row("Ctrl + S", "Save project"),
    row("Ctrl + O", "Open a file"),
  ])}
</section>

<!-- notebook -->
<section>
  <h3>Engineering notebook page</h3>
  <p>Every time you press <b>Run</b>, Robot Lab records the test run. Press <b>📓</b> (next to Show code) or
  <b>File → Notebook page…</b>, then type your name and answer the four questions. Star ☆ the runs you want on the page
  and add a one-line note to each, like “changed the turn to 85°”.</p>
  <p><b>Print / Save as PDF</b> shows the page; press Print and choose <b>Save as PDF</b> to keep it in Drive, or print it
  and glue it into your notebook. <b>Copy as text</b> is for a notebook in Google Docs. Your notes are saved in your project
  file and are never sent anywhere.</p>
</section>

<section>
  <h3>Saving and turning in</h3>
  <p><b>File → Save</b> makes a <code>.robolab</code> file. Save it to Google Drive, then attach it to your
  assignment in Google Classroom. <b>File → Open</b> opens it again (also teacher challenge files,
  <code>.robolab-level</code>). Your work is also kept in this browser, so <b>Restore last project</b> can bring it back.
  Nothing you write is sent anywhere.</p>
</section>
`;
