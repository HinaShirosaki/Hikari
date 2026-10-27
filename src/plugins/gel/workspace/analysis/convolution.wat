;; SIMD across adjacent pixels, never across kernel taps: each lane keeps the
;; JavaScript reference's f64 multiply/add order and f32 pass-boundary rounding.
;; The caller supplies replicated-edge padding and reusable linear memory.
(module
  (memory (export "memory") 1 1024)
  (func (export "pass")
    (param $src i32) (param $dst i32) (param $kernel i32)
    (param $width i32) (param $rows i32) (param $pitch i32)
    (param $step i32) (param $count i32)
    (local $y i32) (local $x i32) (local $k i32)
    (local $base i32) (local $out i32) (local $sum v128) (local $tail f64)
    (block $done
      (loop $row
        (br_if $done (i32.ge_u (local.get $y) (local.get $rows)))
        (local.set $base (i32.add (local.get $src) (i32.shl (i32.mul (local.get $y) (local.get $pitch)) (i32.const 2))))
        (local.set $out (i32.add (local.get $dst) (i32.shl (i32.mul (local.get $y) (local.get $width)) (i32.const 2))))
        (local.set $x (i32.const 0))
        (block $last
          (loop $pair
            (br_if $last (i32.ge_u (i32.add (local.get $x) (i32.const 1)) (local.get $width)))
            (local.set $sum (f64x2.splat (f64.const 0)))
            (local.set $k (i32.const 0))
            (loop $tap
              (local.set $sum (f64x2.add (local.get $sum)
                (f64x2.mul
                  (f64x2.promote_low_f32x4 (v128.load64_zero
                    (i32.add (local.get $base) (i32.shl (i32.add (local.get $x) (i32.mul (local.get $k) (local.get $step))) (i32.const 2)))))
                  (f64x2.splat (f64.promote_f32 (f32.load (i32.add (local.get $kernel) (i32.shl (local.get $k) (i32.const 2)))))))))
              (local.set $k (i32.add (local.get $k) (i32.const 1)))
              (br_if $tap (i32.lt_u (local.get $k) (local.get $count))))
            (v128.store64_lane 0 (i32.add (local.get $out) (i32.shl (local.get $x) (i32.const 2)))
              (f32x4.demote_f64x2_zero (local.get $sum)))
            (local.set $x (i32.add (local.get $x) (i32.const 2)))
            (br $pair)))
        (if (i32.lt_u (local.get $x) (local.get $width))
          (then
            (local.set $tail (f64.const 0))
            (local.set $k (i32.const 0))
            (loop $scalar
              (local.set $tail (f64.add (local.get $tail)
                (f64.mul
                  (f64.promote_f32 (f32.load (i32.add (local.get $base) (i32.shl (i32.add (local.get $x) (i32.mul (local.get $k) (local.get $step))) (i32.const 2)))))
                  (f64.promote_f32 (f32.load (i32.add (local.get $kernel) (i32.shl (local.get $k) (i32.const 2))))))))
              (local.set $k (i32.add (local.get $k) (i32.const 1)))
              (br_if $scalar (i32.lt_u (local.get $k) (local.get $count))))
            (f32.store (i32.add (local.get $out) (i32.shl (local.get $x) (i32.const 2))) (f32.demote_f64 (local.get $tail)))))
        (local.set $y (i32.add (local.get $y) (i32.const 1)))
        (br $row))))
)
