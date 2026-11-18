# GRASS Language Reference

## Terminology
<ul>
   <li>Picture prototype, snap: sprite.</li>
</ul>

## Duplicates
<pre>
   - DELETE is duplicated in: Current, Publications
   - EDIT is duplicated in: Current, Publications
   - GOTO is duplicated in: Current, Publications
   - INPUT is duplicated in: Current, Publications
   - MOVE is duplicated in: Current, Publications
   - ONERROR is duplicated in: Current, Publications
   - PRINT is duplicated in: Current, Publications
   - PROMPT is duplicated in: Current, Publications
   - RETURN is duplicated in: Current, Publications
   - SKIP is duplicated in: Current, Publications
   - WAIT is duplicated in: Current, Publications
</pre>


## Current

**ABS `value`**<br>
Calculate the absolute value.<br>

**ANYARGS**<br>
Return 1 if the macro it is in still has arguments to take, else 0. Works as a bare name in an expression (`IF ANYARGS,SKIP 2`). (RT/1's `CM2.C`)<br>

**ARRAY `name, size, [size2]`**<br>
Create a 1D or 2D numeric array with the specified dimensions. In a 2D array, the second and third arguments are rows and columns.<br>

**ARCSIN `value`**, **ARCCOS `value`**, **ARCTAN `value`**<br>
The angle whose sine, cosine or tangent is `value`, in degrees, or in radians when `$RD` is 1. ARCSIN and ARCCOS take `value` from -1 to 1 and give an error for anything else. ARCTAN is ATAN. RT/1's always gave radians. Minimum abbreviation `ARCS`, `ARCC`, `ARCT`. (RT/1's `CM2.C`)<br>

**ARRDIM `(array, n)`**<br>
The size of the array's dimension `n`, counting from 0, or 0 for a dimension it hasn't: after `ARRAY FOO,200,10`, `ARRDIM(FOO,0)` is 200, `ARRDIM(FOO,1)` is 10 and `ARRDIM(FOO,2)` is 0. The array's name may be abbreviated. Minimum abbreviation `ARRD`. (RT/1 Glossary)<br>

**ASC `char`**<br>
Convert a character to its corresponding numeric code.<br>

**ASCII `num, [num2, ...]`**<br>
Return the characters with these codes, as CHR. `ASCII.N str` returns the code of the first character, as ASC; `ASCII.P num, ...` prints the characters to the terminal (RT/1 sent them to the printer).<br>

**ATAN `value`**<br>
Calculate the arctangent of `value` and return the angle.<br>

**ATAN2 `y, x`**<br>
Calculate the two-argument arctangent of `y` and `x`.<br>

**BEEP**<br>
Sound a short tone, if the browser lets the page make sound. RT/1 sent its terminal a bell. (RT/1 Glossary)<br>

**BOX `xcenter, ycenter, xsize, ysize, [colormode]`**<br>
Draw a box centered at (`xcenter`, `ycenter`), `xsize` wide and `ysize` high, using the specified `colormode` (defaults to 3).<br>

**CENTER `x, y`**<br>
Put the origin (0, 0) at (`x`, `y`) measured from the screen's centre. Every command's coordinates, and the centres of the drawing modifiers, are measured from it. `CENTER 0,0` puts it back. (GRASS-RT1)<br>

**CHR `num`**<br>
Convert a number to its corresponding character.<br>

**CIRCLE `xcenter, ycenter, xradius, [yradius], [colormode]`**<br>
Draw a circle or ellipse centered at (`xcenter`, `ycenter`) with horizontal radius `xradius` and vertical radius `yradius`. Each pixel of the outline is drawn once, so an XOR circle is whole, and the outline is closed, so FILL stays inside it. `CIRCLE.F` fills it: the outline and everything inside, the same pixels FILL would add. (RT/1)<br>

**CLEAR `[color]`**<br>
Clear the TV screen, to `color` (0 to 3) if one is given (`CLEAR 2`), else to 0, as RT/1's CLEAR did. Using the `.crt` switch (i.e., `clear.crt`, or `CL.C` for short, as RT/1 spelled it) clears the terminal instead.<br>

**COMPILE `macro, newname`**<br>
Zgrass compiled a macro for speed. Macros here always run interpreted, so this copies `macro` to `newname`, which then runs the same.<br>

**CORNER `xsize, ysize`**<br>
Drawing modifier: draw nothing in the `xsize` by `ysize` rectangle at the screen's lower right corner, leaving an L-shaped window. `CORNER 0,0` stops it. (GRASS-RT1)<br>

**COS `angle`**<br>
Calculate the cosine of `angle`.<br>

**DELETE `name`**<br>
Remove a variable or macro with the specified `name`.<br>

**DISPLAY `name, x, y, [displaymode]`**<br>
Blit a previously captured picture prototype (`name`) to the screen at position (`x`, `y`) using an optional `displaymode`: 0 plop, 1 XOR, 2 OR, 3 AND (4, 8 and 12 also give XOR, OR and AND). The drawing modifiers apply to it, as in RT/1.<br>

**EDIT `name`**<br>
Open the full-screen editor for a macro `name`.<br>

**ELLIPSE `xcenter, ycenter, xradius, yradius, [colormode], [angle]`**<br>
CIRCLE's ellipse turned counterclockwise by `angle`, in degrees, or in radians when `$RD` is 1 (RT/1's were always radians). `ELLIPSE.F` fills it. Turned by a whole number of quarter turns it is exactly CIRCLE's ellipse. Turned any other way it is drawn as a polygon with many sides, each pixel once, so an XOR ellipse is still whole. Minimum abbreviation `EL`. (RT/1 Glossary)<br>

**EXP `value`**<br>
Calculate e raised to the power of `value`.<br>

**FILL `x, y, [colormode], [spacing]`**<br>
Fill the area of one color around (`x`, `y`), joined across pixel edges, in `colormode` (default 3). `.L`, `.V`, `.D`, `.N` and `.C` fill with lines `spacing` apart (default 2) instead: across, up and down, diagonal, the other diagonal, or crossed. Returns -1 if (`x`, `y`) is off the screen, else 1. (GRASS-RT1's seed fill, `TFILL.C`)<br>

**GOTO `label`**<br>
Jump to a specified label within the current macro.<br>

**HELP**<br>
List all available commands and basic syntax help.<br>

**IF `condition, command`**<br>
Run the rest of the line, `;`s and all, if `condition` is not 0; otherwise go on to the next line. `IF.N` runs it if `condition` is 0 instead (`IF.N FLAG,B=C+D`). (RT/1 Glossary)<br>

**INPUT `var1, [var2, ...]`**<br>
Get values and assign them to variables, either from macro arguments or from user input via the REPL. A running macro waits for a typed line of comma-separated values; `INPUT.STR` (or RT/1's `INPUT.S`) takes the line as a string. A variable may be given by `@`. `INPUT.N` is `INPUT.STR`, except that a macro argument written as a bare name gives that name rather than its value: with `TAKE=[INPUT.N n;PRINT n]`, `TAKE FOO` prints `FOO`. That lets a macro take names the way RT/1's commands do. `INPUT.F` first throws away what was typed ahead: answers kept for a later INPUT, and the key in `$CH`. (RT/1 Glossary)<br>

**INT `value`**<br>
Truncate a value to its integer component.<br>

**KALIEDOSCOPE `n, [xcenter, ycenter]`**<br>
Drawing modifier: draw everything `n` times, turned in equal steps about the centre (default the CENTER). `KALIEDOSCOPE.C start, n, ...` draws only what falls in the slice starting at angle `start` (degrees, or radians when `$RD` is 1), and turns that slice. Rotated copies have gaps, as in RT/1. `KALIEDOSCOPE 1` stops it. RT/1 spelled it this way; `KALEIDOSCOPE` also works. Minimum abbreviation `KA`. (GRASS-RT1)<br>

**KILL**<br>
Stop every drawing modifier: MIRROR, MULTI, KALIEDOSCOPE, SPHERE, CORNER and PATTERN. CENTER, and the origin PATTERN.C set, stay where they are. (GRASS-RT1)<br>

**LEN `val`**<br>
Get the length of a string or array.<br>

**LINE `x, y, [colormode], [thickness]`**<br>
Draw a line from the current cursor position to (`x`, `y`) using `colormode`. A `thickness` over 1 draws a fat line with a round brush, each pixel once (RT/1).<br>

**LN `value`**<br>
Calculate the natural logarithm of a positive `value`, as LOG does. (RT/1's `CM2.C`)<br>

**LOG `value`**<br>
Calculate the natural logarithm of a positive `value`. RT/1's LOG was base 10, but the UV-1 lessons don't say which Zgrass used, so LOG stays natural here. For base 10, use `LN(x)/LN(10)`.<br>

**LPAD `(str, char, width)`**<br>
Return `str` lengthened to `width` by adding `char` at its start, so numbers line up on the right (`LPAD(A," ",5)`). `.R` adds them at the end instead, and `.C` at both ends to centre it. A string already as wide comes back as it is. (RT/1 Glossary)<br>

**MATCH `(bigstring, substring)`**<br>
Return where `substring` first starts in `bigstring`, counting from 0, or -1 if it isn't there. Capitals and small letters differ. Minimum abbreviation `MAT`. (RT/1 Glossary)<br>

**MAX `a, b`**<br>
Return the maximum of two values.<br>

**MIN `a, b`**<br>
Return the minimum of two values.<br>

**MIRROR.X, MIRROR.Y, MIRROR.XY `[xcenter, ycenter]`**<br>
Drawing modifier: draw everything also reflected across the vertical line `x = xcenter` (`.X`), the horizontal line `y = ycenter` (`.Y`), or both (`.XY`, four copies). The centre defaults to the CENTER. An XOR pixel that lands on its own reflection is drawn twice and vanishes, as in RT/1. Minimum abbreviation `MIR`, so `MI` is still MIN. (GRASS-RT1)<br>

**MOVE `x, y`**<br>
Set the current drawing position (cursor) to (`x`, `y`).<br>

**MULTI `xsize, ysize, [xcenter, ycenter]`**<br>
Drawing modifier: draw everything repeated every `xsize` by `ysize` pixels across the whole screen. With one size 0 it repeats along one axis only; `MULTI` on its own, or `MULTI 0,0`, stops it. Switches: `.X` flips alternate rows of tiles across `xcenter`, `.Y` alternate columns across `ycenter`, `.H` adds checkerboard copies half a tile over, and `MULTI.C colormode, xsize, ysize, ...` draws every copy but the original in another colormode. (GRASS-RT1)<br>

**ONERROR `label`**<br>
Set an error handler by jumping to `label` when an error occurs.<br>

**PI**<br>
Return the constant π (pi).<br>

**PATTERN `[array]`**<br>
Drawing modifier: draw everything in the colormodes of a 2D array (`ARRAY PT,xsize,ysize`), repeated across the screen, whatever colormode a command gives. Element `PT(i,j)` is used `i` pixels right and `j` up from the pattern's origin. The array is copied, so changing it later changes nothing until PATTERN is given it again. `PATTERN` on its own stops it. `PATTERN.C x, y` puts the origin at (`x`, `y`); it starts at (0, 0). A snap DISPLAY draws keeps its own colors, as on RT/1. This is RT/1's PATTERN (`MODIFIER.C`); 16k Zgrass had an unrelated PATTERN that built a pixel list (see Referenced). Minimum abbreviation `PAT`. (GRASS-RT1)<br>

**POINT `x, y, [colormode]`**<br>
Set or read a pixel at (`x`, `y`). Without `colormode`, it returns the pixel value. With `colormode`, it sets the pixel.<br>

**POLYGON `array, colormode, xcenter, ycenter, [xscale, yscale], [angle]`**<br>
Join the points of an N by 2 array in order (x in `(i,0)`, y in `(i,1)`), and the last back to the first, about (`xcenter`, `ycenter`). The points are scaled, then turned counterclockwise by `angle` (degrees, or radians when `$RD` is 1). As in RT/1, one extra argument is the angle, two are the scales and three are both. `POLYGON.F` fills it, by the even-odd rule, so a polygon that crosses itself leaves holes. RT/1's `POLYGON.F` wanted two scratch-array names before the array (`POLYGON.F SC1,SC2,SQ,3,0,0`); they may be given and are not needed. Minimum abbreviation `POL`. (RT/1 Glossary)<br>

**POW `base, exponent`**, **POWER `base, exponent`**<br>
Calculate `base` raised to the power of `exponent`. POWER is RT/1's name (minimum abbreviation `POWE`). RT/1's POWER refused a negative exponent; here both take one.<br>

**PRINT `expr1, [expr2, ...]`**<br>
Print evaluated expressions or values to the terminal, a space between them, then a NEXTLINE. `PRINT.S` leaves out the spaces, and `PRINT.N` the spaces and the NEXTLINE, so the next PRINT goes on the same line (RT/1). Numbers show 6 significant digits, as RT/1's `gcvt(value, 6)` did: `100/3` prints `33.3333`, and very large or small ones print in exponent form (`1.23457e+06`). Whole numbers print whole. Save still writes every digit.<br>

**PROMPT `"text", [expr...]`**<br>
Print its arguments to the terminal like PRINT, but with no NEXTLINE (suppressed when the macro has arguments to consume).<br>

**REPLACE `(bigstring, substring, replacement)`**<br>
Return `bigstring` with `replacement` wherever `substring` was. `REPLACE.O` replaces only the first one. Minimum abbreviation `REP`. (RT/1 Glossary)<br>

**RBOX `xcenter, ycenter, xsize, ysize, angle, [colormode], [width]`**<br>
BOX's outline turned counterclockwise by `angle` (degrees, or radians when `$RD` is 1), `width` pixels wide (default 1). Note that the angle comes before the colormode, as in RT/1. `RBOX.F` fills it, and at angle 0 that is exactly BOX. A size of 0 or less draws nothing and returns -1. Minimum abbreviation `RB`. (RT/1's `MEYERS.C`)<br>

**RETURN `[value]`**<br>
Return from the current macro, optionally with a return value.<br>

**RND `n`**<br>
Generate a random integer from 0 to `n-1`.<br>

**SGN `value`**<br>
Return the sign of `value` (-1 for negative, 0 for zero, 1 for positive).<br>

**SIN `angle`**<br>
Calculate the sine of `angle`.<br>

**SKIP `n`**<br>
Perform a relative jump based on `n` lines (negative for backward, positive for forward, 0 for same line).<br>

**SNAP `name, x, y, xsize, ysize`**<br>
Capture the `xsize` by `ysize` region of the screen centered at (`x`, `y`) as a sprite and store it under `name`. DISPLAY at the same spot puts it back in place.<br>

**SQRT `value`**<br>
Calculate the square root of a non-negative `value`.<br>

**SPHERE `xcenter, ycenter, radius`**<br>
Drawing modifier: wrap the screen onto a sphere of `radius` about (`xcenter`, `ycenter`), seen from the front, so the whole screen fits in its disc. Radius 0 stops it. (GRASS-RT1)<br>

**STOP `name, [name2, ...]`**<br>
Stop the `.B` and `.F` macros running these macros, and leave the rest running (CTRL+C stops them all). A macro may stop itself. The names may be abbreviated. Returns how many it stopped. Minimum abbreviation `STO`, so that `ST` is still STR. (UV-1 lesson 11, RT/1's `CM2.C`)<br>

**STR `num`**<br>
Convert a number to a string, with 6 significant digits as PRINT shows it. Joining a number to a string with `&` or `+` formats it the same way.<br>

**STRING `str, index, [code1, code2, ...]`**<br>
Return the character code at `index` (counting from 0) in `str`. With codes, write them into the string from `index` on, as far as its end, and return the last one written; a variable passed as `str` holds the new string. An index outside the string is an error. Minimum abbreviation `STRI`. (RT/1's `CM2.C`)<br>

**SUBSTR `str, begin, end`**<br>
Return the characters of `str` from `begin` to `end`, counting from 0, both included. `end` past the string stops at its end, and `begin` after `end` gives an empty string. Minimum abbreviation `SUBS`. (RT/1's `CM2.C`)<br>

**TAN `angle`**<br>
Calculate the tangent of `angle`.<br>

**TIMEOUT `n`**<br>
Run the `.F` macro it is in once every `n` frames (1/60 second each).<br>

**USEMAP**<br>
List all user-defined names (variables and macros) in the environment.<br>

**VAL `str`**<br>
Convert a string to a number.<br>

**WHATSIS `name`**<br>
Return what kind of value `name` holds, using RT/1's numbers: 2 nothing, 4 a whole number, 6 a number with a fraction, 8 a string or macro, 16 an array. The name is not abbreviated, and nothing it names is run. `WHATSIS.A array` returns the kind of value the array's elements hold, which here is always 6, since LICHEN's arrays hold any number. Minimum abbreviation `WHA`. (RT/1 Glossary)<br>

**WAIT `n`**<br>
Pause execution of the current macro for `n` frames (1/60s per frame).<br>

**WHILE `condition,{ lines }ENDWHILE`**<br>
Run the lines inside the braces again and again while `condition` is true. The braces may hold several lines, and `ENDWHILE` must follow the closing brace on the same line. As in RT/1, where WHILE was IF and ENDWHILE was `SKIP 0`, a WHILE that starts a line of a macro does one pass through the braces each time that line runs, so `.B` and `.F` macros keep running alongside it and ESC stops it. A WHILE typed at the prompt runs the same way. A WHILE after a `;` or an IF, or inside another WHILE's braces, runs its whole loop at once, and stops with an error after 100000 passes. GOTO or SKIP inside the braces leaves the loop. (RT/1 Glossary, `CMDS.C`, `COMP.C`)<br>

### Operators

**`+ - * / \ % &`**, **`== < > <= >=`**, **`AND OR NOT`**: as before. RT/1's own spellings also work (`GLOB.C`): **`#`** and `<>` for not equal (`!=` too), **`=<`** and **`=>`** for `<=` and `>=`, **`&&`** and **`||`** for AND and OR.<br>
**`!value`**: the absolute value, at the same precedence as unary minus: `!-5` is 5, `1+!-2*3` is 7. (RT/1)<br>
**`?name`**: the value of `name`, as in a macro's arguments (`SQUAREM(?a,?b)`). Arguments are always values here, so it changes nothing.<br>
**`@name`**: indirection: the variable whose name is the string `name` holds. With `TOM=12;SAM="TOM"`, `PRINT @SAM` prints 12 and `@SAM=7` sets TOM. The string may name an array element (`@(ANAME&"("&1&")")`), and `@` works where a command takes a name (`ARRAY @ANAME,n`, `DISPLAY @P,0,0`, `INPUT @V`, `STOP @M`). It binds tighter than anything else, so `@SAM+1` is `(@SAM)+1`. (RT/1 Glossary, BASIC Zgrass 1978)<br>
**Numbers** may start with the point: `B=B+.02`, `IF X<=.7`.<br>
**Comments**: a line starting with `.` is a comment, and so is the rest of a line after `;` and a `.`, blanks allowed between: `LINE 6,-70,1;.THIS LINE HAS A COMMENT`. A quote or bracket in a comment means nothing. (RT/1 Glossary, BASIC Zgrass 1978)<br>
**Errors, not quiet wrong answers**: a character that is no operator (`|`, `^`, `~`) is an error, as RT/1's "unknown character in expression"; so is a switch the command doesn't take (`BOX.F`, `PRINT.Q`), as its "illegal/unknown switch", a name called with parentheses that is no function, array or macro (`COSH(1)`), and setting an element of something that is no array (`X(1)=5` before `ARRAY X,...`; it used to set the variable X). An array's name may be abbreviated when an element is set, as when one is read (`PY(2)=7` for PYR). A bare name that has not been set still reads as 0.<br>

**`++name`, `--name`**: add 1 to the variable, or take 1 from it, and return its new value: `++B`, `IF (++K)<58,SKIP -1`, `PRINT ++A+7` (that is, `(++A)+7`). The signs must be written right against the name; `9--A` is still 9 minus -A. (RT/1)<br>

### Drawing modifiers

MIRROR, MULTI, KALIEDOSCOPE, SPHERE, CORNER and PATTERN come from RT/1 (`RT1/BASELINE/MODIFIER.C`). Every pixel that BOX, LINE, POINT, CIRCLE, ELLIPSE, RBOX, POLYGON, FILL and DISPLAY draw passes through them; CLEAR doesn't. They stack: each new kind is applied before the ones set up earlier, so `MIRROR.X` then `MULTI 80,0` repeats the original and its reflection across the screen. Setting one up again changes its values but keeps its place in the stack. KILL removes them all.

### Device variables

**`$X1`, `$Y1`, `$T1`, `$K1`**: joystick 1's stick (-1, 0 or 1), trigger, and knob (-128 to 127).<br>
**`$L0`–`$L3`, `$R0`–`$R3`, `$HB`**: the left and right colors, and the boundary between them in 8-pixel columns.<br>
**`$HR`, `$MN`, `$SC`**: the clock. Setting one sets the time.<br>
**`$Z0`–`$Z9`**: timers. A timer set to a number counts down by 1 every frame (60 a second) until it reaches 0, whether or not a macro is running. Set one and wait until it reads 0.<br>
**`$TK`**: frames counted up since the module started (RT/1's tick counter).<br>
**`$CH`**: the code of the last key typed in fullscreen (RT/1).<br>
**`$RD`**: 0 for degrees, 1 for radians.<br>
**`$AB`**: 1 makes command names exact, with no abbreviations, so an abbreviation reaches a macro of that name instead (RT/1). Default 0.<br>


## Referenced

### Publications

**ANYARGS**<br>
Tells if there are arguments passed to a macro. (ZGRASS)<br>

**BYE**<br>
Logs user out; useful for changing disk areas. (GRASS)<br>

**CALL `macroname`**<br>
Similar to DO, but uses the system area of the disk and tries to find a compiled version of the macro. (GRASS)<br>

**CHANGE**<br>
Changes the values of an endpoint in a picture prototype list. (16k extension ZGRASS)<br>

**CLEAR.CRT / CL.C**<br>
Erases the terminal screen. (ZGRASS)<br>

**CLIP**<br>
Clips one picture against another (like film matting or video keying). (GRASS)<br>

**CLOSE**<br>
Closes off an open picture prototype list. (16k extension ZGRASS)<br>

**COLOR `lname, expr`**<br>
Sets up the LNAME for use with the color wheel. (GRASS)<br>

**COLORS**<br>
Chooses 4 colors of 256 for screen use. (ZGRASS)<br>

**COMPIL / COMPILE `mname1, mname2` (or `macro, ct`)**<br>
Compiles code for speed; resolves pseudo-labels in macros. (GRASS, ZGRASS)<br>

**COPY `lname1, lname2`**<br>
Makes a copy of a picture prototype (or data structure) with a new name. (GRASS, ZGRASS)<br>

**CORE**<br>
Gives a list of the memory segments. (ZGRASS)<br>

**DASHES `lname`**<br>
Changes the LNAME's vectors to dash mode. (GRASS)<br>

**DBAKS**<br>
Removes all backup (BAK) files from the disk. (ZGRASS)<br>

**DCREATE `submapname, [message]`**<br>
Creates a submap on the disk to partition it into project areas. (ZGRASS)<br>

**DDELETE `name`**<br>
Deletes a name/file on the disk. (ZGRASS)<br>

**DDELETE.BAK `name`**<br>
Deletes a backup file on the disk to save space. (ZGRASS)<br>

**DDSMAP `submapname`**<br>
Removes a submap and all its entries from the disk. (ZGRASS)<br>

**DELETE `aname`**<br>
Deletes and reclaims storage of a named thing from core. (GRASS, ZGRASS)<br>

**DELPOI**<br>
Deletes the last previously put point in an OPENO'd list. (GRASS)<br>

**DFORMAT**<br>
Formats a floppy disk. (ZGRASS)<br>

**DGET `name`**<br>
Gets a file/name from the disk into memory. (ZGRASS)<br>

**DGET.BAK `name`**<br>
Gets a backup copy of a file from the disk. (ZGRASS)<br>

**DINIT `max_names`**<br>
Initializes a disk to accept a maximum number of names/files. (ZGRASS)<br>

**DIRALL**<br>
Gives the user the disk directories of everyone's areas. (GRASS)<br>

**DLOAD**<br>
Loads a disk module. (ZGRASS)<br>

**DO `macroname`**<br>
Transfers control to execute a named macro. (GRASS)<br>

**DOLOOP `macnam1; macnam2...`**<br>
Sets up a ring structure of macros so they can be executed in parallel round-robin fashion. (GRASS)<br>

**DPUT `name, [message]`**<br>
Puts a name/file on the disk; automatically keeps one backup copy. (ZGRASS)<br>

**DSETUP `disknum` (or `disknum, submap`)**<br>
Sets up the disk drive and optionally a submap for subsequent disk commands. (ZGRASS)<br>

**DUSEMAP**<br>
Lists the names (files) currently stored in the disk map. (ZGRASS)<br>

**EDIT `macroname`**<br>
Invokes an interactive full-screen editor to create or change a character string/macro. (ZGRASS)<br>

**EXIT**<br>
A super return that acts like a ^C within a macro and returns control to terminal level. (GRASS)<br>

**FETCH**<br>
Retrieves a given endpoint in a picture prototype list. (16k extension ZGRASS)<br>

**FILL `outline, fill-lines, fill-character, speed, degrees`**<br>
Traces an OUTLINE and builds a new LNAME composed of the FILL-CHARACTER randomly placed within the outline. (GRASS)<br>

**FILM**<br>
Sets up filming mode for a Super 8 camera. (16k extension ZGRASS)<br>

**FILMING**<br>
Sets single framing mode. (GRASS)<br>

**FIX `pname`**<br>
Freezes the position of a picture or the value of a PNAME's modifier. Disables hardware transformations. (GRASS)<br>

**FLAP `pname, expr1, expr2`**<br>
Puts bounds on the rotation angle (higher and lower bounds). (GRASS)<br>

**FSOFF `expr1, expr2, expr3...`**<br>
Turns off the function switches corresponding to the expressions. (GRASS)<br>

**FSON `expr1, expr2, expr3...`**<br>
Turns on function switches so that they light up. (GRASS)<br>

**GET**<br>
Gets a macro, array, picture prototype list, etc. from tape, disk, etc. (ZGRASS)<br>

**GETCOM `dname.ext`**<br>
Same as GETDSK except it takes DNAME from the COMMON area on the disk. (GRASS)<br>

**GETDSK `dname.ext[30,x]`**<br>
Gets the DNAME from the disk area indicated and brings it into memory. (GRASS)<br>

**GETHIT `n, x, y, z, k`**<br>
Gives the status of a lightpen hit. (GRASS)<br>

**GETLIB `pname1, pname2`**<br>
Gets PNAME1 from non-displayed data structure and puts it into the displayed data structure. (GRASS)<br>

**GETPOINT / GETPOIN `lname, n, x, y, z, k`**<br>
Gets the Nth point from a picture (LNAME) and places its coordinates and status into variables. (GRASS)<br>

**GETTAPE `name`**<br>
Reads a macro, array, or file from audio cassette tape. (ZGRASS)<br>

**GOTO `mname+expression`**<br>
Transfers control to named macros or labels for looping. (GRASS, ZGRASS)<br>

**GROUP `pname1, pname2, gname`**<br>
Collects picture prototypes into a group hierarchy so transformations can be applied collectively. (GRASS, ZGRASS)<br>

**HIDE `pname`**<br>
Hides the rear surfaces of specially prepared 3-D shaded pictures. (GRASS)<br>

**IEEE**<br>
Provides interface to the IEEE bus. (ZGRASS)<br>

**IF `variable == expression, command`**<br>
Conditional branching and command execution. (GRASS, ZGRASS)<br>

**INPUT `var1, var2...`**<br>
Used to input numbers from the terminal or grab arguments passed to a macro. (GRASS, ZGRASS)<br>

**INPUT.STR `var`**<br>
Inputs strings from the user. (ZGRASS)<br>

**INTERP `outline, shade-lines, expr`**<br>
Creates a new picture by running lines between the vectors of the OUTLINE. (GRASS)<br>

**LINES `lname`**<br>
Puts LNAME's vectors in regular drawing mode (recovers from dashes and points modes). (GRASS)<br>

**LIST**<br>
Causes lines of macros to be echoed during execution; useful debugging tool. (GRASS)<br>

**MEMORY**<br>
Gives a usage map of memory. (ZGRASS)<br>

**MOVE `pname, x-device, y-device, z-device`**<br>
Translates or attaches a picture prototype to devices or variables so it updates automatically. (GRASS, ZGRASS)<br>

**ONERROR `variable, command`**<br>
Traps errors and sets up an asynchronous error recovery procedure. (GRASS, 16k extension ZGRASS)<br>

**OPEN**<br>
Allocates storage and starts up a picture prototype list. (16k extension ZGRASS)<br>

**OPENO `lname`**<br>
Allocates the core memory necessary to create a picture and sets the LNAME for DELPOI and PUTPOI. (GRASS)<br>

**PATHMOV `pname, lname, speed`**<br>
Moves PNAME tangentially along a path (LNAME) according to the speed. (GRASS)<br>

**PATTERN**<br>
Allows a pixel list to be directly built rather than snapped. (16k extension ZGRASS)<br>

**PENOFF**<br>
Turns the light pen off. (GRASS)<br>

**PENSEN `lname`**<br>
Makes a LNAME sensitive to light pen hits. (GRASS)<br>

**PERSP**<br>
Does perspective projection on a vector list. (GRASS)<br>

**PLAY `score`**<br>
Interprets a string, array, or picture prototype as a musical score to be played by the synthesizer. (ZGRASS)<br>

**POINTS `lname`**<br>
Changes LNAME's vectors to display only the endpoints. (GRASS)<br>

**PRINT `expression` (or `dname.ext`)**<br>
Evaluates an expression and outputs it to the terminal. In GRASS, types a disk file to a DECWRITER hardcopy. (GRASS, ZGRASS)<br>

**PROMPT `string, expr...`**<br>
Prints a string or values to prompt the user. Suppressed if arguments are passed to the macro. (GRASS, ZGRASS)<br>

**PUT**<br>
Stores a macro, array, picture prototype list, etc. on tape, disk, etc. (ZGRASS)<br>

**PUTDSK `dname.ext`**<br>
Puts a name onto the user's area on the disk in the indicated format. (GRASS)<br>

**PUTLIB `pname`**<br>
Puts a picture into the non-displayed data structure. (GRASS)<br>

**PUTPOINT / PUTPOIN `x, y, z, k`**<br>
Adds a point into an open picture list indicated by an OPENO command. (GRASS)<br>

**PUTTAPE `number, macroname, [message]`**<br>
Stores a macro, array, or screen dump on audio tape multiple times for safety. (ZGRASS)<br>

**READ `dosdevice`**<br>
Changes the read device for TYPE and PRINT to the new device. (GRASS)<br>

**REMARK / REMARK* `comment_text`**<br>
Allows insertion of comments in macros. (GRASS)<br>

**RENAME `aname1, aname2`**<br>
Renames a named thing (or disk file) to a new name. (GRASS, ZGRASS)<br>

**RESET `pname`**<br>
Resets the rotation matrix, origin, scale, intensity, etc., to original values (same as FIX). (GRASS)<br>

**RESTART**<br>
Re-initializes the entire system. (GRASS)<br>

**RESUME**<br>
Returns from terminal input mode to a macro in execution. (GRASS)<br>

**RETURN**<br>
Pops up one level in the macro being executed; can pass arguments back. (GRASS, ZGRASS)<br>

**ROTATE `pix, axis, speed, [tilt], [origin]`**<br>
Rotates a picture about an axis at a constant speed or angular position. (GRASS, 16k extension ZGRASS)<br>

**SCALE `pname, factor`**<br>
Scales all three dimensions (or individual axes) of a picture by a factor. (GRASS, 16k extension ZGRASS)<br>

**SELECT**<br>
Causes picture prototypes to be switched round-robin fashion on the screen. (ZGRASS)<br>

**SETCUT `pname, value`**<br>
Sets the z-axis depth cueing and cutoff feature of the scope until disabled. (GRASS)<br>

**SETDELA `delay`**<br>
Sets a delay to slow down disk operations. (GRASS)<br>

**SETINT `pname, value`**<br>
Sets the intensity of the picture to be continuously variable on a device until disabled. (GRASS)<br>

**SHADE `outline, shade-lines, spacing, degrees`**<br>
Shades in an outline with vectors, building a new LNAME. (GRASS)<br>

**SKIP `expression`**<br>
Transfers control within a macro for looping by skipping a specified number of lines forwards or backwards. (GRASS, ZGRASS)<br>

**SMOOTH `lname, number`**<br>
Does a binomial smoothing of a 2-D vector list a specified number of times. (GRASS)<br>

**SOFT / SOFTROT `lname`**<br>
Carries out hardware transformations (rotation, moving, scaling) on the vectors by software, modifying the display list. (GRASS)<br>

**SYNC**<br>
Tells the system how much time to devote to interrupt-level updating versus command processing. (ZGRASS)<br>

**TEXT `cname, lname`**<br>
Automatically calls a character set and creates an LNAME consisting of character subroutine calls. (GRASS)<br>

**TRACE `variables...`**<br>
Prints out the values of variables every time they are changed, along with the location of the change. (GRASS)<br>

**TREE**<br>
Gives a schematic diagram of the user's data structure and grouping hierarchies. (GRASS)<br>

**TYPE `dname.ext[30,x]`**<br>
Types a file from the disk onto the terminal. (GRASS)<br>

**UNFILM**<br>
Resets to normal run mode after filming was used. (GRASS)<br>

**VIP `macroname`**<br>
Very Important Program; schedules a macro to be executed at interrupt level. (GRASS, 16k extension ZGRASS)<br>

**WAIT**<br>
Causes the macro to wait for the user to type RESUME on the terminal. (GRASS, ZGRASS)<br>

**WARP `lname, dev1, dev2`**<br>
Changes the shape of line segments according to the devices. (GRASS)<br>

**WINDOW**<br>
Does normal 3-D windowing. (GRASS)<br>

**WRITE `dosdevice`**<br>
Changes the PUTDSK device. (GRASS)<br>

**ZAPPOINT `lname, n, x, y, z, k`**<br>
Modifies or accesses individual vector endpoints. (GRASS)<br>


### Implementations

These come from RT/1 (GRASS-RT1) and are implemented here; see Current for details.

**CENTER `x, y`**<br>
Set the drawing origin/center. (GRASS-RT1)<br>

**CORNER `xsize, ysize`**<br>
Mask the lower right corner of the screen, for an L-shaped window. (GRASS-RT1)<br>

**ELLIPSE**, **RBOX**, **POLYGON** (switch `.F`), and **CIRCLE.F**<br>
Turned ellipses and boxes, polygons from an array, and filled shapes. (GRASS-RT1)<br>

**FILL `x, y, color`** (switches `.L .V .D .N .C`)<br>
Seed fill. (GRASS-RT1)<br>

**KALIEDOSCOPE `n, [xc, yc]`**, **KALIEDOSCOPE.C `start, n, [xc, yc]`**<br>
Set up a kaleidoscope drawing modifier; `.C` clips to one slice. (GRASS-RT1)<br>

**KILL**<br>
Clear all drawing modifiers. (GRASS-RT1)<br>

**MIRROR.X, MIRROR.Y, MIRROR.XY `[xc, yc]`**<br>
Set up a mirror drawing modifier. The axes are switches, not arguments. (GRASS-RT1)<br>

**MULTI `xsize, ysize, [xc, yc]`** (switches `.X .Y .C .H`; `.C` takes a color first)<br>
Set up a multi drawing modifier. (GRASS-RT1)<br>

**PATTERN `array`**, **PATTERN.C `x, y`**<br>
Set up a pattern drawing modifier. (GRASS-RT1)<br>

**SPHERE `xc, yc, r`**<br>
Set up a sphere drawing modifier. (GRASS-RT1)<br>

**LN**, **ARCSIN**, **ARCCOS**, **ARCTAN**, **POWER**, **ARRDIM**, **WHATSIS**, **BEEP**, **CLEAR `color`**, **INPUT.N**, **INPUT.F**<br>
Functions and commands from RT/1's glossary. (GRASS-RT1)<br>


### Alternative Versions

**CIRCLE**<br>
Draws an ellipse on the screen and has options for building picture prototype lists. (ZGRASS, GRASS-RT1)<br>

**HELP `command-name`**<br>
Prints command names and required argument types for assistance. (GRASS, ZGRASS, GRASS-RT1)<br>

