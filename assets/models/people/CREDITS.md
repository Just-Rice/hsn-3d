# Character credits

`student-*.glb` are built by [`tools/character`](../../../tools/character) in Blender.

**Avatars.** From the [Microsoft Rocketbox Avatar Library](https://github.com/microsoft/Microsoft-Rocketbox)
(`Male_Adult_17` → student-m1, `Female_Adult_17` → f1, `Male_Adult_10` → m2, `Female_Adult_12` → f2), MIT License:

> Copyright (c) Microsoft Corporation.
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software
> and associated documentation files (the "Software"), to deal in the Software without
> restriction, including without limitation the rights to use, copy, modify, merge, publish,
> distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
> Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or
> substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
> BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
> NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
> DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

**Motion capture**, retargeted onto the avatars:

| Clip | Source | License |
| --- | --- | --- |
| walk | [Bandai Namco Research Motion dataset 1](https://github.com/BandaiNamcoResearchInc/Bandai-Namco-Research-Motiondataset), `walk_normal_001` | [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) (© Bandai Namco Research Inc.) |
| idle | [CMU Graphics Lab Motion Capture Database](http://mocap.cs.cmu.edu/) 77_02 "standing" | free to use; "The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217." |
| run | CMU 35_17 "run/jog" | as above |
| sprint | CMU 16_46 "run/jog" | as above |
| jump | CMU 16_01 "jump" | as above |
| swim | CMU 126_10 "free style" | as above |

The CMU clips were read from the BVH conversion at [una-dinosauria/cmu-mocap](https://github.com/una-dinosauria/cmu-mocap).
Because of the Bandai Namco clip, the character files are for non-commercial use.
