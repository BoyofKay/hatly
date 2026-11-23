import 'dart:async';
import 'package:flutter/material.dart';

/// A pager that never ends: swiping past the last item shows the first again, and swiping back from the first shows the last, in either
/// direction, with no jump, rewind or blank frame. It works by paging over a very large virtual range that starts in the middle (a multiple
/// of [count], so item 0 is on screen at first) and showing `index % count`; the auto-play always glides FORWARD (it never animates back
/// across all the items). Auto-play pauses while a finger is down, is off when the OS asks for reduced motion, and never runs for one item.
/// With a single item it is an ordinary, non-looping page.
class LoopingPager extends StatefulWidget {
  const LoopingPager({
    super.key,
    required this.count,
    required this.itemBuilder,
    this.onIndexChanged,
    this.viewportFraction = 1.0,
    this.autoPlayInterval = const Duration(seconds: 5),
    this.autoPlayGlide = const Duration(milliseconds: 450),
    this.autoPlayCurve = Curves.easeOutCubic,
    this.controllerForTest,
  });

  final int count;
  final Widget Function(BuildContext context, int index) itemBuilder;
  final ValueChanged<int>? onIndexChanged;
  final double viewportFraction;
  final Duration autoPlayInterval;
  /// Optional motion override for hero banners; other pagers retain their existing animation.
  final Duration autoPlayGlide;
  final Curve autoPlayCurve;
  final PageController? controllerForTest;

  /// Far enough from 0 that nobody swipes to either end in a lifetime, and divisible by every realistic [count].
  static const int _midpoint = 1 << 20;

  /// The first virtual page that shows item 0 for a given count.
  static int startPageFor(int count) => count <= 1 ? 0 : (_midpoint ~/ count) * count;

  @override
  State<LoopingPager> createState() => _LoopingPagerState();
}

class _LoopingPagerState extends State<LoopingPager> {
  late final PageController _controller = widget.controllerForTest ?? _newController();
  Timer? _timer;
  bool _reduceMotion = false;
  int _realIndex = 0;

  PageController _newController() => PageController(
        viewportFraction: widget.viewportFraction,
        initialPage: LoopingPager.startPageFor(widget.count),
      );

  bool get _loops => widget.count > 1;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _reduceMotion = MediaQuery.of(context).disableAnimations;
    _restartTimer();
  }

  @override
  void didUpdateWidget(LoopingPager old) {
    super.didUpdateWidget(old);
    if (old.count != widget.count) {
      // The list changed length: the old virtual page number means something else now, so restart on the first item. The parent usually
      // setState()s from onIndexChanged, which is not allowed while the tree is building — both happen after the frame.
      _realIndex = 0;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        if (_controller.hasClients) _controller.jumpToPage(LoopingPager.startPageFor(widget.count));
        widget.onIndexChanged?.call(0);
      });
      _restartTimer();
    }
  }

  void _restartTimer() {
    _timer?.cancel();
    _timer = null;
    if (_reduceMotion || !_loops) return;
    _timer = Timer.periodic(widget.autoPlayInterval, (_) {
      if (!mounted || !_controller.hasClients) return;
      _controller.nextPage(duration: widget.autoPlayGlide, curve: widget.autoPlayCurve);
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    if (widget.controllerForTest == null) _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.count <= 0) return const SizedBox.shrink();
    return NotificationListener<ScrollNotification>(
      onNotification: (n) {
        if (n is ScrollStartNotification && n.dragDetails != null) {
          _timer?.cancel(); // a finger is down: stop moving the page under it
        } else if (n is ScrollEndNotification) {
          _restartTimer();
        }
        return false;
      },
      child: PageView.builder(
        controller: _controller,
        itemCount: _loops ? null : 1,
        onPageChanged: (page) {
          final real = _loops ? page % widget.count : 0;
          if (real != _realIndex) {
            setState(() => _realIndex = real);
            widget.onIndexChanged?.call(real);
          }
        },
        itemBuilder: (context, page) => widget.itemBuilder(context, _loops ? page % widget.count : 0),
      ),
    );
  }
}
