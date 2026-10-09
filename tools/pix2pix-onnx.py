# Converts a pix2pix generator into the file the Pix2Pix module loads: int8
# weights, run in fp16, with float32 input and output (see Pix2Pix Module in
# ARCHITECTURE.md, and docs/REPORT_PIX2PIX.md for why each step is there). It
# takes either an fp32 ONNX export (the Latk models' *_net_G_simplified.onnx)
# or a PyTorch checkpoint of pix2pix's unet_256 generator (*_net_G.pth).
#
# Usage: python tools/pix2pix-onnx.py <in.onnx | in.pth> <out.onnx>
# Needs: pip install onnx onnxconverter-common numpy, and torch for a .pth
#
# Steps:
#   0. A .pth is loaded into unet_256 and exported to fp32 ONNX, in eval mode,
#      so BatchNorm uses its running statistics, as Latk ran it.
#   1. Fold each BatchNormalization into the Conv or ConvTranspose before it.
#      The deepest one's running_var is up to 207,805, above fp16's 65,504, and
#      onnxconverter-common clamps anything over 10,000 to 10,000 unasked, which
#      corrupts the picture. The folded weights stay small.
#   2. Name the graph's input and output `input` and `output`.
#   3. Convert to fp16, keeping float32 input and output.
#   4. Store each Conv and ConvTranspose weight as int8, symmetric, one scale
#      per output channel, behind DequantizeLinear and a Cast to fp16. This
#      halves the file again, to 54.5 MB. Sessions should set the config entry
#      session.disable_quant_qdq = '1', so that ONNX Runtime turns the weights
#      back into fp16 once, when the session starts, instead of on every run.
import io
import sys
import warnings
import numpy as np
import onnx
from onnx import helper, numpy_helper, version_converter, TensorProto
from onnxconverter_common import float16

FP16_CLAMP = 1e4    # onnxconverter-common's default max_finite_val
SIZE = 256          # unet_256's input, which halves 8 times to 1 x 1


# pix2pix's unet_256 generator (UnetGenerator in Zhu and Park's
# pytorch-CycleGAN-and-pix2pix, with BatchNorm and no dropout), laid out as
# theirs is so that a checkpoint's keys match it, from the outermost level in
def export_pth(path):
    import torch
    from torch import nn

    class Level(nn.Module):
        def __init__(self, outer, inner, inside=None, input_nc=None, outermost=False):
            super().__init__()
            self.outermost = outermost
            down = nn.Conv2d(input_nc or outer, inner, 4, 2, 1, bias=False)
            if outermost:
                layers = [down, inside, nn.ReLU(), nn.ConvTranspose2d(inner * 2, outer, 4, 2, 1), nn.Tanh()]
            elif inside is None:
                layers = [nn.LeakyReLU(0.2), down, nn.ReLU(),
                          nn.ConvTranspose2d(inner, outer, 4, 2, 1, bias=False), nn.BatchNorm2d(outer)]
            else:
                layers = [nn.LeakyReLU(0.2), down, nn.BatchNorm2d(inner), inside, nn.ReLU(),
                          nn.ConvTranspose2d(inner * 2, outer, 4, 2, 1, bias=False), nn.BatchNorm2d(outer)]
            self.model = nn.Sequential(*layers)

        def forward(self, x):
            if self.outermost:
                return self.model(x)
            # pix2pix's LeakyReLU works in place, so its skip carries x after it
            x = self.model[0](x)
            return torch.cat([x, self.model[1:](x)], 1)

    class Generator(nn.Module):
        def __init__(self, input_nc, output_nc, ngf):
            super().__init__()
            level = Level(ngf * 8, ngf * 8)
            for _ in range(3):
                level = Level(ngf * 8, ngf * 8, level)
            for mult in (4, 2, 1):
                level = Level(ngf * mult, ngf * mult * 2, level)
            self.model = Level(output_nc, ngf, level, input_nc=input_nc, outermost=True)

        def forward(self, x):
            return self.model(x)

    state = torch.load(path, map_location='cpu', weights_only=True)
    state = {k.removeprefix('module.'): v for k, v in state.items()}
    ngf, input_nc = state['model.model.0.weight'].shape[:2]
    output_nc = state['model.model.3.weight'].shape[1]
    net = Generator(input_nc, output_nc, ngf)
    net.load_state_dict(state)
    net.eval()
    buf = io.BytesIO()
    with torch.no_grad(), warnings.catch_warnings():
        # The TorchScript exporter is deprecated, but its graph is the one the Latk exports have
        warnings.simplefilter('ignore', DeprecationWarning)
        torch.onnx.export(net, torch.zeros(1, input_nc, SIZE, SIZE), buf, opset_version=13,
                          input_names=['input'], output_names=['output'], dynamo=False)
    return onnx.load_from_string(buf.getvalue())


def fold_batchnorms(graph):
    inits = {t.name: t for t in graph.initializer}
    producer = {o: n for n in graph.node for o in n.output}
    uses = {}
    for n in graph.node:
        for i in n.input:
            uses[i] = uses.get(i, 0) + 1
    folded = []
    for bn in [n for n in graph.node if n.op_type == 'BatchNormalization']:
        conv = producer.get(bn.input[0])
        if conv is None or conv.op_type not in ('Conv', 'ConvTranspose') or uses[bn.input[0]] != 1:
            raise SystemExit(f'{bn.name or bn.output[0]}: a BatchNormalization not after a Conv or ConvTranspose of its own')
        if next((a.i for a in conv.attribute if a.name == 'group'), 1) != 1:
            raise SystemExit(f'{conv.name or conv.output[0]}: grouped convolutions are not handled')
        gamma, beta, mean, var = (numpy_helper.to_array(inits[x]).astype(np.float64) for x in bn.input[1:5])
        eps = next((a.f for a in bn.attribute if a.name == 'epsilon'), 1e-5)
        scale = gamma / np.sqrt(var + eps)
        w = numpy_helper.to_array(inits[conv.input[1]]).astype(np.float64)
        # Output channels are axis 0 of a Conv's weight, and axis 1 of a ConvTranspose's
        w = w * (scale[:, None, None, None] if conv.op_type == 'Conv' else scale[None, :, None, None])
        b = numpy_helper.to_array(inits[conv.input[2]]).astype(np.float64) if len(conv.input) > 2 else 0
        b = (b - mean) * scale + beta
        wname, bname = conv.input[1] + '_bn', conv.output[0] + '_bn_bias'
        graph.initializer.extend([numpy_helper.from_array(w.astype(np.float32), wname),
                                  numpy_helper.from_array(b.astype(np.float32), bname)])
        del conv.input[1:]
        conv.input.extend([wname, bname])
        conv.output[0] = bn.output[0]
        folded.append(bn)
    for bn in folded:
        graph.node.remove(bn)
    used = {i for n in graph.node for i in n.input}
    keep = [t for t in graph.initializer if t.name in used]
    del graph.initializer[:]
    graph.initializer.extend(keep)
    return len(folded)


def rename(graph, old, new):
    # PyTorch's export already names an inner tensor `input`, so that moves aside first
    names = {t for n in graph.node for t in list(n.input) + list(n.output)}
    if new != old and new in names:
        spare = new
        while spare in names:
            spare += '_'
        rename(graph, new, spare)
    for n in graph.node:
        for k, i in enumerate(n.input):
            if i == old:
                n.input[k] = new
        for k, o in enumerate(n.output):
            if o == old:
                n.output[k] = new
    for v in list(graph.input) + list(graph.output) + list(graph.value_info):
        if v.name == old:
            v.name = new


def quantize_weights(graph, weights):
    inits = []
    nodes = []
    replaced = set()
    for n in graph.node:
        if n.op_type not in ('Conv', 'ConvTranspose'):
            continue
        name = n.input[1]
        w = weights[name]
        axis = 0 if n.op_type == 'Conv' else 1
        scale = np.abs(w).max(axis=tuple(i for i in range(w.ndim) if i != axis)) / 127
        scale[scale == 0] = 1
        shape = [1] * w.ndim
        shape[axis] = -1
        q = np.clip(np.round(w / scale.reshape(shape)), -127, 127).astype(np.int8)
        inits += [numpy_helper.from_array(q, name + '_q'),
                  numpy_helper.from_array(scale.astype(np.float32), name + '_scale'),
                  numpy_helper.from_array(np.zeros_like(scale, dtype=np.int8), name + '_zero')]
        nodes += [helper.make_node('DequantizeLinear', [name + '_q', name + '_scale', name + '_zero'], [name + '_dq'],
                                   axis=axis, name=name + '_dequantize'),
                  helper.make_node('Cast', [name + '_dq'], [name + '_fp16'], to=TensorProto.FLOAT16, name=name + '_cast')]
        n.input[1] = name + '_fp16'
        replaced.add(name)
    keep = [t for t in graph.initializer if t.name not in replaced]
    del graph.initializer[:]
    graph.initializer.extend(keep + inits)
    rest = list(graph.node)
    del graph.node[:]
    graph.node.extend(nodes + rest)
    del graph.value_info[:]
    return len(replaced)


def main(src, dst):
    model = export_pth(src) if src.endswith('.pth') else onnx.load(src)
    graph = model.graph
    if len(graph.input) != 1 or len(graph.output) != 1:
        raise SystemExit(f'{src}: expected one input and one output')
    folded = fold_batchnorms(graph)
    rename(graph, graph.input[0].name, 'input')
    rename(graph, graph.output[0].name, 'output')
    weights = {t.name: numpy_helper.to_array(t) for t in graph.initializer}
    convs = {n.input[1] for n in graph.node if n.op_type in ('Conv', 'ConvTranspose')}
    # Everything but the conv weights, which go to int8, is cast to fp16 as it is
    for name, a in weights.items():
        if name not in convs and a.dtype.kind == 'f' and a.size and np.abs(a).max() > FP16_CLAMP:
            raise SystemExit(f'{name}: {np.abs(a).max():.0f} would be clamped to {FP16_CLAMP:.0f} in fp16')
    onnx.checker.check_model(model)

    with warnings.catch_warnings():
        # It warns about every weight too small for fp16, which it rounds to ±1e-7
        warnings.simplefilter('ignore')
        model = float16.convert_float_to_float16(model, keep_io_types=True)
    # DequantizeLinear's per-channel axis needs opset 13
    model = version_converter.convert_version(model, 13)
    quantized = quantize_weights(model.graph, weights)
    onnx.checker.check_model(model)
    onnx.save(model, dst)
    print(f'{dst}: folded {folded} BatchNormalization, {quantized} weights to int8')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('usage: python tools/pix2pix-onnx.py <in.onnx | in.pth> <out.onnx>')
    main(sys.argv[1], sys.argv[2])
