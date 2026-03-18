# GRASS Language Reference

## Current

**ABS `value`**<br>
Calculate the absolute value.<br>

**ARRAY `name, size, [size2]`**<br>
Create a 1D or 2D numeric array with the specified dimensions.<br>

**ASC `char`**<br>
Convert a character to its corresponding numeric code.<br>

**ATAN `value`**<br>
Calculate the arctangent of `value` and return the angle.<br>

**ATAN2 `y, x`**<br>
Calculate the two-argument arctangent of `y` and `x`.<br>

**BOX `xcenter, ycenter, xsize, ysize, [colormode]`**<br>
Draw a box centered at (`xcenter`, `ycenter`) with half-width `xsize` and half-height `ysize` using the specified `colormode` (defaults to 3).<br>

**CHR `num`**<br>
Convert a number to its corresponding character.<br>

**CIRCLE `xcenter, ycenter, xradius, [yradius], [colormode]`**<br>
Draw a circle or ellipse centered at (`xcenter`, `ycenter`) with horizontal radius `xradius` and vertical radius `yradius`.<br>

**CLEAR**<br>
Clear the TV screen. Using the `.crt` switch (i.e., `clear.crt`) clears the terminal instead.<br>

**COMPILE `macro, newname`**<br>
Currently a stub; intended to compile a macro for speed, but currently macros run interpreted.<br>

**COS `angle`**<br>
Calculate the cosine of `angle`.<br>

**DELETE `name`**<br>
Remove a variable or macro with the specified `name`.<br>

**DISPLAY `snap, x, y, [displaymode]`**<br>
Blit a previously captured sprite (`snap`) to the screen at position (`x`, `y`) using an optional `displaymode`.<br>

**EDIT `name`**<br>
Open the full-screen editor for a macro `name`.<br>

**EXP `value`**<br>
Calculate e raised to the power of `value`.<br>

**GOTO `label`**<br>
Jump to a specified label within the current macro.<br>

**HELP**<br>
List all available commands and basic syntax help.<br>

**INPUT `var1, [var2, ...]`**<br>
Get values and assign them to variables, either from macro arguments or from user input via the REPL.<br>

**INT `value`**<br>
Truncate a value to its integer component.<br>

**LEN `val`**<br>
Get the length of a string or array.<br>

**LINE `x, y, [colormode]`**<br>
Draw a line from the current cursor position to (`x`, `y`) using `colormode`.<br>

**LOG `value`**<br>
Calculate the natural logarithm of a positive `value`.<br>

**MAX `a, b`**<br>
Return the maximum of two values.<br>

**MIN `a, b`**<br>
Return the minimum of two values.<br>

**MOVE `x, y`**<br>
Set the current drawing position (cursor) to (`x`, `y`).<br>

**ONERROR `label`**<br>
Set an error handler by jumping to `label` when an error occurs.<br>

**PI**<br>
Return the constant π (pi).<br>

**POINT `x, y, [colormode]`**<br>
Set or read a pixel at (`x`, `y`). Without `colormode`, it returns the pixel value. With `colormode`, it sets the pixel.<br>

**POW `base, exponent`**<br>
Calculate `base` raised to the power of `exponent`.<br>

**PRINT `expr1, [expr2, ...]`**<br>
Print evaluated expressions or values to the terminal.<br>

**PROMPT `"text"`**<br>
Print prompt text to the terminal (suppressed when the macro has arguments to consume).<br>

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
Capture a rectangular region of the screen as a sprite and store it under `name`.<br>

**SQRT `value`**<br>
Calculate the square root of a non-negative `value`.<br>

**STR `num`**<br>
Convert a number to a string.<br>

**TAN `angle`**<br>
Calculate the tangent of `angle`.<br>

**TIMEOUT `n`**<br>
Set the foreground macro timing interval in frames.<br>

**USEMAP**<br>
List all user-defined names (variables and macros) in the environment.<br>

**VAL `str`**<br>
Convert a string to a number.<br>

**WAIT `n`**<br>
Pause execution of the current macro for `n` frames (1/60s per frame).<br>

## Referenced

### Publications

**ANYARGS**<br>
Tells if there are arguments passed to a macro. (ZGRASS)<br>

**ARRAY `name, size` (or `name, rows, cols`)**<br>
Creates an array of the specified size. (ZGRASS)<br>

**BYE**<br>
Logs user out; useful for changing disk areas. (GRASS)<br>

**CALL `macroname`**<br>
Similar to DO, but uses the system area of the disk and tries to find a compiled version of the macro. (GRASS)<br>

**CHANGE**<br>
Changes the values of an endpoint in a picture prototype list. (16k extension ZGRASS)<br>

**CIRCLE**<br>
Draws an ellipse on the screen and has options for building picture prototype lists. (ZGRASS)<br>

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

**DISPLAY `name, x, y, displaymode`**<br>
Causes a picture prototype (or snap) to be exclusive or'ed or placed onto the screen and updated when necessary. (ZGRASS)<br>

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

**HELP `command-name`**<br>
Prints command names and required argument types for assistance. (GRASS, ZGRASS)<br>

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
