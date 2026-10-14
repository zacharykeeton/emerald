# plant

Puts a sapling in every empty spot, `spacing` metres apart (four by default). It is the first thing an orchard needs and the only feature the demo repository starts with.

```
import { run } from '../src/orchard/plant.js';
run([{}, {}, {}], { spacing: 5 });
```
